/**
 * Step 4 — propose cuts, then wait for a human.
 *
 * The approval gate is a Mastra `suspend()`, not application state (idea.md
 * §4.2). Mastra persists the snapshot, so the approval can arrive minutes or
 * days later, across a server restart, and the run picks up where it stopped.
 * That's the whole reason there's no job registry or status enum in this
 * codebase.
 */

import { z } from "zod"

import { cleanupAgent } from "../agents/cleanup-agent"
import { readStoredProject, updateProject } from "../lib/project"
import {
  assertTiles,
  buildSegments,
  cutsToSpans,
  describeCut,
  renderSegments,
  windowSegments,
  type CutDecision,
} from "../lib/segments"
import { generateStructured, settled } from "../lib/structured"
import { SpanCategorySchema, type Span } from "../schemas"
import type { PipelineWriter } from "../stream/contract"
import { message, reporter } from "./shared"

const CutsSchema = z.object({
  cuts: z.array(
    z.object({
      from: z.number().int(),
      to: z.number().int(),
      category: SpanCategorySchema,
      reason: z.string(),
    })
  ),
})

/**
 * The first pass, callable on its own.
 *
 * `app/api/pipeline/route.ts` reuses it for the "Propose cuts" action outside
 * the workflow. Proposing is not approving — it only ever writes fresh
 * `spans` with `cleanupApprovedAt` cleared, never touches anything a human
 * has already approved downstream, so running it again is always safe to
 * look at before committing to it.
 */
export async function proposeCleanup(
  projectPath: string,
  writer: PipelineWriter | undefined
) {
  const report = reporter("cleanup", writer)
  await report.start()

  try {
    const project = await readStoredProject(projectPath)
    const segments = buildSegments(project.transcript.words)

    if (segments.length === 0) {
      throw new Error("No transcript to clean up — run transcription first.")
    }

    const windows = windowSegments(segments)
    const cuts: CutDecision[] = []

    for (const [index, window] of windows.entries()) {
      // Only worth naming when there's more than one — a lone "Pass 1 of 1"
      // implies a sequence the user should be tracking, and there isn't one.
      const pass =
        windows.length > 1 ? `Pass ${index + 1} of ${windows.length}` : null

      await report.progress(
        index / windows.length,
        pass ?? "Reading the transcript"
      )

      let announced = 0

      /** One cut, logged as the words it removes rather than two indices. */
      const describe = (cut: Partial<CutDecision>, position: number) => {
        const line = describeCut(cut, window, position + 1)
        return line ? report.log(line) : Promise.resolve()
      }

      const result = await generateStructured({
        agent: cleanupAgent,
        schema: CutsSchema,
        label: "cleanup",
        onPartial: (partial) => {
          for (const cut of settled(partial.cuts, announced)) {
            void describe(cut, announced)
            announced += 1
          }
          // Creeps within the pass rather than jumping between passes. The
          // divisor is a guess at a typical cut count — capped, so a long
          // window can't run the bar past the pass it's in.
          const found = `${announced} cut${announced === 1 ? "" : "s"} so far`
          void report.progress(
            (index + Math.min(0.95, announced / 40)) / windows.length,
            pass ? `${pass} · ${found}` : found
          )
        },
        prompt: [
          "Here is the transcript as numbered segments. Decide what to cut.",
          "",
          renderSegments(window),
          "",
          `Return cuts referring to these segment indices (${window[0].index}–${window[window.length - 1].index}).`,
        ].join("\n"),
      })

      // Whatever the stream didn't get to announce — always at least the last
      // element, which the one-short rule above deliberately holds back.
      for (let i = announced; i < result.cuts.length; i += 1) {
        await describe(result.cuts[i], i)
      }

      cuts.push(...result.cuts)
      await report.log(
        `${pass ?? "Total"}: ${result.cuts.length} cuts proposed`
      )
    }

    // Indices back to seconds, gaps filled with keeps. This is where §3's
    // guarantee is actually enforced: the model named cuts, and the spans
    // that come out of here tile the transcript with nothing missing.
    const spans = cutsToSpans(cuts, segments)
    assertTiles(spans, segments)

    await updateProject(projectPath, (current) => ({
      ...current,
      spans,
      // Proposing is not approving. Anything gated on approval stays gated
      // until the human comes back.
      cleanupApprovedAt: null,
    }))

    const summary = summarize(spans)
    await report.emit("cleanup", summary)
    await report.done()
    return summary
  } catch (error) {
    await report.failed(message(error))
    throw error
  }
}

/**
 * The approval, callable on its own — a direct write, not a workflow resume.
 * `spans` is what the human actually approved after toggling any of them.
 */
export async function approveCleanup(projectPath: string, spans: Span[]) {
  await updateProject(projectPath, (project) => ({
    ...project,
    spans,
    cleanupApprovedAt: new Date().toISOString(),
  }))
  return summarize(spans)
}

function summarize(spans: Span[]) {
  const counts = new Map<z.infer<typeof SpanCategorySchema>, number>()
  let cutSeconds = 0

  for (const span of spans) {
    if (span.action !== "cut") continue
    cutSeconds += span.end - span.start
    if (span.category) {
      counts.set(span.category, (counts.get(span.category) ?? 0) + 1)
    }
  }

  return {
    spans,
    cutSeconds,
    counts: [...counts.entries()].sort((a, b) => b[1] - a[1]) as [
      z.infer<typeof SpanCategorySchema>,
      number,
    ][],
  }
}
