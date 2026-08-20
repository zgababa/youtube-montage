/**
 * Step 5 — write the cut timeline as FCPXML, before scenes exist.
 *
 * Placed right after `cleanupStep`'s gate and before `scenariosStep`
 * (`docs/adr/0002-…`): this step only needs `spans`, which the human approved
 * at the previous gate, not scenes — which are the expensive part of the
 * pipeline and haven't been generated yet. A user who only wants the cut
 * timeline gets it without paying for scene generation at all.
 *
 * Same gate check as `scenariosStep`: no approved spans, no export. Both
 * steps read `cleanupApprovedAt` independently rather than one passing a flag
 * to the other, because `{ projectPath }` is the only thing that flows
 * through the workflow graph (see `shared.ts`).
 */

import fs from "node:fs/promises"
import { createStep } from "@mastra/core/workflows"

import { buildFcpxml } from "../lib/fcpxml"
import { fcpxmlPath } from "../lib/paths"
import { readStoredProject } from "../lib/project"
import { buildSegments } from "../lib/segments"
import { buildKeptRuns } from "../lib/timeline"
import { PipelineIO, reporter, runStep } from "./shared"

export const timelineStep = createStep({
  id: "fcpxml",
  description: "Write the cut timeline as FCPXML",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  execute: async ({ inputData, writer }) => {
    const report = reporter("fcpxml", writer)
    const { projectPath } = inputData

    return runStep(report, async () => {
      const project = await readStoredProject(projectPath)

      if (!project.cleanupApprovedAt) {
        throw new Error(
          "Cleanup hasn't been approved — the timeline export needs the approved cut list."
        )
      }

      const segments = buildSegments(project.transcript.words)
      const runs = buildKeptRuns(segments, project.spans, project.media)

      const xml = buildFcpxml(project, runs)
      const file = fcpxmlPath(projectPath)
      await fs.writeFile(file, xml, "utf8")

      await report.emit("fcpxml", { path: file })
      await report.log(`${runs.length} runs written to ${file}`)

      return { projectPath }
    })
  },
})
