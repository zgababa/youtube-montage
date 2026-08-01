/**
 * The pipeline (idea.md §4).
 *
 * Raw footage in, ProRes overlays and a shot list out, with two human gates
 * along the way. Steps pass only `{ projectPath }` between them — every result
 * goes to `project.json` — so the graph reads as sequence rather than as data
 * plumbing.
 */

import { createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { readStoredProject } from "../lib/project"
import { copyStep } from "../steps/copy"
import { cleanupStep } from "../steps/cleanup"
import { exportStep } from "../steps/export"
import { extractAudioStep } from "../steps/extract-audio"
import { SceneJobSchema } from "../steps/generate-scene"
import { reviewStep } from "../steps/review"
import { scanStep } from "../steps/scan"
import { scenariosStep } from "../steps/scenarios"
import { PipelineIO } from "../steps/shared"
import { shotlistStep } from "../steps/shotlist"
import { styleGuideStep } from "../steps/style-guide"
import { transcribeStep } from "../steps/transcribe"
import { generateSceneWorkflow } from "./generate-scene-workflow"

/**
 * Modest on purpose (idea.md §4.4). Three concurrent scene agents stays inside
 * rate limits and keeps three Chromium instances validating at once, which is
 * already as much as a laptop wants to do while the user is editing.
 */
const SCENE_CONCURRENCY = 3

export const brollWorkflow = createWorkflow({
  id: "broll-pipeline",
  description:
    "Transcribe a folder of footage, decide what to cut, generate animated b-roll scenes, and export them to ProRes",
  inputSchema: PipelineIO,
  outputSchema: z.object({
    exported: z.array(z.string()),
  }),
})
  .then(scanStep)
  .then(extractAudioStep)
  .then(transcribeStep)
  // Suspends: the human approves the diff before anything downstream runs.
  .then(cleanupStep)
  .then(styleGuideStep)
  .then(scenariosStep)
  // `.foreach` consumes an array, so the single `{ projectPath }` has to be
  // fanned out into one self-contained job per scene here.
  .map(async ({ inputData }) => {
    const project = await readStoredProject(inputData.projectPath)
    return project.scenes.map((scene) => ({
      projectPath: inputData.projectPath,
      scene,
      styleGuide: project.styleGuide,
    })) satisfies z.infer<typeof SceneJobSchema>[]
  })
  .foreach(generateSceneWorkflow, { concurrency: SCENE_CONCURRENCY })
  // And folded back in: `.foreach` returns a bare array of per-scene results,
  // which carries no `projectPath`. `getInitData()` recovers it from the run's
  // original input rather than threading it through every scene job's output.
  .map(async ({ getInitData }) => getInitData<PipelineIO>())
  // Suspends: approve, reject, or regenerate scenes.
  .then(reviewStep)
  .then(exportStep)
  .then(copyStep)
  .then(shotlistStep)
  .commit()
