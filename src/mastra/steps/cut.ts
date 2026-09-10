/**
 * Step 6 — actually cut the source media from the approved spans (issue #27).
 *
 * Sits right after `timelineStep`'s gate, on purpose: that gate is where
 * `maxSilenceSec` gets settled, and this step's plan (`buildCutPlan`,
 * `lib/cut.ts`) reads the same `project.maxSilenceSec` the FCPXML spine does
 * — running after the gate is what keeps the described cut and the performed
 * one looking at the same value in the normal flow.
 *
 * No suspend, unlike `timelineStep`/`overlayStep`. Those gates exist because
 * they're taste calls (how much silence to trim) or because they're the first
 * look at a rewritten file; this step introduces no new decision at all — it
 * mechanically executes spans a human already approved at the cleanup gate —
 * so there's nothing here for a human to review before the run continues.
 *
 * The "cleanup must be approved" guard lives once, in `buildCutPlan`
 * (`lib/cut.ts`) — this step doesn't re-check it before calling `cutMedia`,
 * it just lets that error surface through `runStep`'s own reporting.
 */

import { createStep } from "@mastra/core/workflows"

import { cutMedia, type CutResult } from "../lib/cut"
import { readStoredProject, updateProject } from "../lib/project"
import { PipelineIO, reporter, runStep } from "./shared"

export const cutStep = createStep({
  id: "cut",
  description: "Cut the source media from the approved spans",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  execute: async ({ inputData, writer }) => {
    const report = reporter("cut", writer)
    const { projectPath } = inputData

    return runStep(report, async () => {
      const project = await readStoredProject(projectPath)
      const result: CutResult = await cutMedia(project)

      await updateProject(projectPath, (current) => ({
        ...current,
        cutAt: new Date().toISOString(),
      }))

      await report.emit("cut", {
        runCount: result.runCount,
        totalDurationSec: result.totalDurationSec,
      })
      await report.log(`${result.outputPath} (${result.runCount} runs)`)

      return { projectPath }
    })
  },
})
