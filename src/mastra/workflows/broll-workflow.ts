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
import { PipelineIO, reporter } from "../steps/shared"
import type { PipelineWriter } from "../stream/contract"
import { shotlistStep } from "../steps/shotlist"
import { timelineStep } from "../steps/timeline"
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
  // Only needs the approved spans — writes the cut timeline before scene
  // generation (the expensive part) even starts (issue #1, ADR 0002).
  .then(timelineStep)
  // No style-guide step: the look is a house style with a per-project override
  // (`design.md`), not something an agent derives from the transcript.
  .then(scenariosStep)
  // `.foreach` consumes an array, so the single `{ projectPath }` has to be
  // fanned out into one self-contained job per scene here.
  //
  // The fan-out is also where the `generate` row starts and stops reporting.
  // Nothing else can: the phase is a `.foreach` rather than a step, so there is
  // no single execution whose lifecycle the panel could follow — which is why
  // the row used to sit on "waiting" through the whole phase and stay there
  // long after every scene had come back.
  .map(async ({ inputData, writer }) => {
    const project = await readStoredProject(inputData.projectPath)
    await reporter("generate", writer as PipelineWriter).start()

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
  //
  // Reached whether or not every scene succeeded — one scene failing is not the
  // phase failing (it reports itself on its own card), and the run continues.
  .map(async ({ getInitData, writer }) => {
    await reporter("generate", writer as PipelineWriter).done()
    return getInitData<PipelineIO>()
  })
  // Suspends: approve, reject, or regenerate scenes.
  .then(reviewStep)
  .then(exportStep)
  .then(copyStep)
  .then(shotlistStep)
  .commit()
