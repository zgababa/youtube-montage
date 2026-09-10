/**
 * Step 10 — compose the cut video and the beat sheet into a final video via
 * HyperFrames, then suspend for approval (issue #29).
 *
 * Replaces the old FCPXML rewrite (`buildFcpxml`/`placeOverlays`,
 * `lib/fcpxml.ts`): this step no longer writes `timeline.fcpxml`. It hands
 * `cut.mp4` (issue #27) and every approved scene's beat sheet entry, remapped
 * onto that cut video (issue #28), to a `HyperFramesClient`
 * (`lib/hyperframes.ts`) and gets back one finished, directly-publishable
 * video — the `Composé` of `docs/glossary.md` now names that file, not an
 * FCPXML reference.
 *
 * The gate itself is unchanged from the old `overlayStep`: same id, same
 * `review-composite` reason, same `{ path, placedCount, skipped }` shape the
 * UI (`composite-review.tsx`) already reads — only what produces them
 * changed. A fourth gate rather than a silent rewrite (idea.md §4.2 covers
 * the other three): this is the first look at the actual finished video.
 */

import { createStep } from "@mastra/core/workflows"
import { z } from "zod"

import { composeVideo } from "../lib/compose"
import { resolveHyperFramesClient } from "../lib/hyperframes"
import { readStoredProject, updateProject } from "../lib/project"
import { PipelineIO, message, reporter } from "./shared"

export const overlayStep = createStep({
  id: "overlay",
  description:
    "Compose the cut video and beat sheet into a final video via HyperFrames, then suspend for approval",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  resumeSchema: z.object({
    approved: z.boolean(),
  }),
  suspendSchema: z.object({
    reason: z.literal("review-composite"),
    path: z.string(),
    placedCount: z.number(),
    skipped: z.array(z.string()),
  }),
  execute: async ({ inputData, resumeData, writer, runId, suspend }) => {
    const report = reporter("overlay", writer)
    const { projectPath } = inputData

    try {
      if (!resumeData) await report.start()

      const project = await readStoredProject(projectPath)
      const result = await composeVideo(project, resolveHyperFramesClient())
      const stats = {
        path: result.outputPath,
        placedCount: result.placedCount,
        skipped: result.skipped,
      }

      if (resumeData?.approved) {
        await updateProject(projectPath, (current) => ({
          ...current,
          compositeApprovedAt: new Date().toISOString(),
        }))
        await report.emit("composite", stats)
        await report.done()
        return { projectPath }
      }

      await report.emit("composite", stats)
      await report.emit("gate", {
        on: "review-composite",
        runId,
        step: "overlay",
      })
      await report.suspended()

      return suspend({ reason: "review-composite", ...stats })
    } catch (error) {
      await report.failed(message(error))
      throw error
    }
  },
})
