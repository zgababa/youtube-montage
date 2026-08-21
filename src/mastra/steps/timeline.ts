/**
 * Step 5 — write the cut timeline as FCPXML, then suspend for approval.
 *
 * Placed right after `cleanupStep`'s gate and before `scenariosStep`
 * (`docs/adr/0002-…`): this step only needs `spans`, which the human approved
 * at the previous gate, not scenes — which are the expensive part of the
 * pipeline and haven't been generated yet. A user who only wants the cut
 * timeline gets it without paying for scene generation at all.
 *
 * The third gate (idea.md §4.2 covers the other two): a real DaVinci import
 * showed the silence between kept segments needed trimming to read as a
 * dynamic edit, and that's a taste call, not something to bake in and hope is
 * right. So this step suspends the same way `cleanupStep` does — the file is
 * written and reviewable before the run continues — and, like `reviewStep`,
 * can be sent back for another pass without leaving the gate: a rejected
 * resume just regenerates the file with a new `maxSilenceSec` and suspends
 * again, as many times as the human wants to try a value.
 *
 * Same gate check as `scenariosStep` for the first pass: no approved spans,
 * no export. Both steps read `cleanupApprovedAt` independently rather than
 * one passing a flag to the other, because `{ projectPath }` is the only
 * thing that flows through the workflow graph (see `shared.ts`).
 */

import fs from "node:fs/promises"
import { createStep } from "@mastra/core/workflows"
import { z } from "zod"

import { buildFcpxml } from "../lib/fcpxml"
import { fcpxmlPath } from "../lib/paths"
import { readStoredProject, updateProject } from "../lib/project"
import { buildSegments } from "../lib/segments"
import { buildKeptRuns, type TimelineRun } from "../lib/timeline"
import type { StoredProject } from "../schemas"
import { PipelineIO, message, reporter } from "./shared"

export const timelineStep = createStep({
  id: "fcpxml",
  description: "Write the cut timeline as FCPXML, then suspend for approval",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  resumeSchema: z.object({
    approved: z.boolean(),
    maxSilenceSec: z.number().positive(),
  }),
  suspendSchema: z.object({
    reason: z.literal("review-timeline"),
    path: z.string(),
    maxSilenceSec: z.number(),
    runsCount: z.number(),
    totalDurationSec: z.number(),
  }),
  execute: async ({ inputData, resumeData, writer, runId, suspend }) => {
    const report = reporter("fcpxml", writer)
    const { projectPath } = inputData

    try {
      if (resumeData) {
        // Cheap and deterministic — no LLM call, no rendering — so every
        // resume regenerates the file rather than trying to tell "just
        // approving" from "changed the value first": what's on disk always
        // matches what was last submitted.
        const project = await readStoredProject(projectPath)
        const stats = await writeTimeline(project, resumeData.maxSilenceSec)

        if (resumeData.approved) {
          await updateProject(projectPath, (current) => ({
            ...current,
            maxSilenceSec: resumeData.maxSilenceSec,
            timelineApprovedAt: new Date().toISOString(),
          }))
          await report.emit("fcpxml", {
            ...stats,
            maxSilenceSec: resumeData.maxSilenceSec,
          })
          await report.done()
          return { projectPath }
        }

        await report.emit("fcpxml", {
          ...stats,
          maxSilenceSec: resumeData.maxSilenceSec,
        })
        await report.emit("gate", {
          on: "review-timeline",
          runId,
          step: "fcpxml",
        })
        await report.suspended()
        return suspend({
          reason: "review-timeline",
          maxSilenceSec: resumeData.maxSilenceSec,
          ...stats,
        })
      }

      await report.start()

      const project = await readStoredProject(projectPath)

      if (!project.cleanupApprovedAt) {
        throw new Error(
          "Cleanup hasn't been approved — the timeline export needs the approved cut list."
        )
      }

      const stats = await writeTimeline(project, project.maxSilenceSec)

      await report.emit("fcpxml", {
        ...stats,
        maxSilenceSec: project.maxSilenceSec,
      })
      await report.emit("gate", { on: "review-timeline", runId, step: "fcpxml" })
      await report.suspended()

      return suspend({
        reason: "review-timeline",
        maxSilenceSec: project.maxSilenceSec,
        ...stats,
      })
    } catch (error) {
      await report.failed(message(error))
      throw error
    }
  },
})

/** Rebuilds the runs and writes `timeline.fcpxml`, returning what the UI shows. */
async function writeTimeline(project: StoredProject, maxSilenceSec: number) {
  const segments = buildSegments(project.transcript.words)
  const runs = buildKeptRuns(segments, project.spans, project.media, maxSilenceSec)

  const xml = buildFcpxml(project, runs)
  const file = fcpxmlPath(project.path)
  await fs.writeFile(file, xml, "utf8")

  return {
    path: file,
    runsCount: runs.length,
    totalDurationSec: totalDuration(runs),
  }
}

function totalDuration(runs: TimelineRun[]): number {
  return runs.reduce((sum, run) => sum + (run.sourceEnd - run.sourceStart), 0)
}
