/**
 * The per-scene pipeline, run once per placement.
 *
 * A nested workflow rather than a bare step (idea.md §4.4) so that each scene
 * progresses through its own run independently: under `.foreach`, twelve scenes
 * advance in parallel three at a time instead of all of them waiting on the
 * slowest one at each stage.
 */

import { createWorkflow } from "@mastra/core/workflows"

import {
  SceneJobSchema,
  SceneResultSchema,
  generateSceneStep,
} from "../steps/generate-scene"

export const generateSceneWorkflow = createWorkflow({
  id: "generate-scene",
  inputSchema: SceneJobSchema,
  outputSchema: SceneResultSchema,
})
  .then(generateSceneStep)
  .commit()
