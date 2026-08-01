/**
 * Step 4 — propose cuts, then wait for a human.
 *
 * The approval gate is a Mastra `suspend()`, not application state (idea.md
 * §4.2). Mastra persists the snapshot, so the approval can arrive minutes or
 * days later, across a server restart, and the run picks up where it stopped.
 * That's the whole reason there's no job registry or status enum in this
 * codebase.
 */

import { createStep } from "@mastra/core/workflows"
import { z } from "zod"

import { cleanupAgent } from "../agents/cleanup-agent"
import { readStoredProject, updateProject } from "../lib/project"
import {
  assertTiles,
  buildSegments,
  cutsToSpans,
  renderSegments,
  windowSegments,
  type CutDecision,
} from "../lib/segments"
import { generateStructured } from "../lib/structured"
import { SpanCategorySchema, SpanSchema, type Span } from "../schemas"
import { PipelineIO, message, reporter } from "./shared"

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

export const cleanupStep = createStep({
  id: "cleanup",
  description: "Propose span decisions, then suspend for human approval",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  resumeSchema: z.object({
    approved: z.boolean(),
    /** What the human actually approved — they can toggle any span. */
    spans: z.array(SpanSchema),
  }),
  suspendSchema: z.object({
    reason: z.literal("review-cleanup"),
    spans: z.array(SpanSchema),
  }),
  execute: async ({ inputData, resumeData, writer, runId, suspend }) => {
    const report = reporter("cleanup", writer)
    const { projectPath } = inputData

    /* ---------------------------------------------------------------- */
    /* Coming back from approval                                         */
    /* ---------------------------------------------------------------- */

    if (resumeData) {
      if (!resumeData.approved) {
        // Rejection isn't a failure — it means the user wants to look again.
        // Re-suspend on the spans they sent back rather than killing the run.
        await report.suspended()
        return suspend({ reason: "review-cleanup", spans: resumeData.spans })
      }

      await updateProject(projectPath, (project) => ({
        ...project,
        spans: resumeData.spans,
        cleanupApprovedAt: new Date().toISOString(),
      }))

      await report.emit("cleanup", summarize(resumeData.spans))
      await report.done()
      return { projectPath }
    }

    /* ---------------------------------------------------------------- */
    /* First pass                                                        */
    /* ---------------------------------------------------------------- */

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
        await report.progress(
          index / windows.length,
          windows.length > 1
            ? `Pass ${index + 1} of ${windows.length}`
            : undefined
        )

        const result = await generateStructured({
          agent: cleanupAgent,
          schema: CutsSchema,
          label: "cleanup",
          prompt: [
            "Here is the transcript as numbered segments. Decide what to cut.",
            "",
            renderSegments(window),
            "",
            `Return cuts referring to these segment indices (${window[0].index}–${window[window.length - 1].index}).`,
          ].join("\n"),
        })

        cuts.push(...result.cuts)
        await report.log(`Pass ${index + 1}: ${result.cuts.length} cuts`)
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

      await report.emit("cleanup", summarize(spans))
      await report.emit("gate", {
        on: "review-cleanup",
        runId,
        step: "cleanup",
      })
      await report.suspended()

      return suspend({ reason: "review-cleanup", spans })
    } catch (error) {
      await report.failed(message(error))
      throw error
    }
  },
})

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
