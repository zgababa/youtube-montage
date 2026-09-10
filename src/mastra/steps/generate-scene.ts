/**
 * One scene: resolve its style, realize it as a beat sheet entry, persist.
 *
 * Runs once per scene under `.foreach(..., { concurrency: 3 })`. Two things
 * follow from that:
 *
 *   - **Nothing here is allowed to throw.** In Mastra a single throwing
 *     iteration fails the whole block (idea.md §4.4), and one bad scene must
 *     not kill a run that produced eleven good ones. Failures come back as
 *     `status: "failed"` with the reason attached.
 *   - Scene updates land out of order. Each emits `data-scene` keyed by scene
 *     id so the client reconciles them in place instead of appending.
 *
 * The realization itself (issue #24) is a pure, synchronous translation —
 * `realizeScene` in `../lib/beat-sheet` — from a `StoredScene` and a resolved
 * `ChannelStyle` to a `Beat sheet` entry. No LLM call, no Playwright render:
 * everything below this point is I/O and event plumbing around that pure
 * function, unchanged from the old mechanism's shape so `reviewStep`'s
 * regenerate path keeps working against the same seam.
 */

import { createStep } from "@mastra/core/workflows"
import { z } from "zod"

import { CLEARED_RENDER_FIELDS, realizeScene } from "../lib/beat-sheet"
import { updateProject } from "../lib/project"
import { resolveStyle } from "../lib/style"
import { SceneSchema, type Scene, type StoredScene } from "../schemas"
import { emitter, type PipelineWriter } from "../stream/contract"

export const SceneJobSchema = z.object({
  projectPath: z.string(),
  scene: SceneSchema,
  styleRef: z.string(),
})

export type SceneJob = z.infer<typeof SceneJobSchema>

export const SceneResultSchema = z.object({
  id: z.string(),
  status: SceneSchema.shape.status,
})

export const generateSceneStep = createStep({
  id: "generate-scene",
  description: "Realize one scene as a beat sheet entry and persist it",
  inputSchema: SceneJobSchema,
  outputSchema: SceneResultSchema,
  execute: async ({ inputData, writer }) => {
    const stream = writer as PipelineWriter | undefined
    const result = await generateAndPersistScene(inputData, stream)

    // Only the foreach runs this step — review regenerates a scene by calling
    // the body directly — so this line belongs to the `generate` row and can't
    // land in a phase that has already reported itself finished.
    await emitter(stream)("log", {
      step: "generate",
      line: `${result.id} → ${result.status}`,
    })

    return result
  },
})

/**
 * The body of the step, callable on its own.
 *
 * Review reuses it: regenerating a rejected scene is the same resolve-style →
 * realize → persist path, just triggered by a human instead of by the
 * foreach.
 *
 * Unlike the old LLM/Playwright path, realization is synchronous — there is
 * no interim "generating" state worth publishing, since nothing happens
 * between starting and finishing. Everything `resolveStyle`/`realizeScene`
 * can throw (an unresolvable `styleRef`, `NoMatchingCardError`,
 * `SlotConstraintError`, or a genuine bug) is caught in one place below and
 * turned into the same explicit `failed` scene — the run continues and the
 * other scenes finish regardless of which of those it was.
 */
export async function generateAndPersistScene(
  job: SceneJob,
  writer: PipelineWriter | undefined
): Promise<z.infer<typeof SceneResultSchema>> {
  const { projectPath, scene, styleRef } = job
  const emit = emitter(writer)
  const publish = (next: Scene) => emit("scene", next, { id: next.id })

  let realized: StoredScene
  try {
    realized = realizeScene(scene, resolveStyle(styleRef))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    realized = {
      ...scene,
      ...CLEARED_RENDER_FIELDS,
      status: "failed",
      beatSheetEntry: null,
      error: reason,
    }
  }

  await updateProject(projectPath, (project) => ({
    ...project,
    scenes: project.scenes.map((s) => (s.id === scene.id ? realized : s)),
  }))

  await publish({ ...realized, html: null })

  if (realized.status === "failed") {
    // Not fatal: the run continues and the other scenes finish.
    await emit("failure", {
      step: "generate",
      message: `${scene.id}: ${realized.error}`,
      fatal: false,
    })
  }

  return { id: scene.id, status: realized.status }
}
