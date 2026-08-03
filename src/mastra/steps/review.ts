/**
 * Step 8 — the second gate.
 *
 * Approve, reject, or regenerate-with-note, per scene (idea.md §10). Regenerate
 * is handled here rather than by looping the workflow back: the step reruns the
 * same generate → validate → repair path for the scenes that asked for it, then
 * suspends again so the new versions get reviewed too. A scene can go round
 * that loop as many times as the user has patience for, and the run never
 * leaves the gate until they're done.
 */

import { createStep } from "@mastra/core/workflows"
import { z } from "zod"

import { readStoredProject, updateProject } from "../lib/project"
import { modelLabel, SCENE_MODEL } from "../models"
import { SceneStatusSchema, type StoredScene } from "../schemas"
import type { PipelineWriter } from "../stream/contract"
import { generateAndPersistScene } from "./generate-scene"
import { PipelineIO, message, reporter } from "./shared"

const DecisionSchema = z.object({
  id: z.string(),
  action: z.enum(["approve", "reject", "regenerate"]),
  /** Only meaningful for `regenerate` — fed back into the scene prompt. */
  note: z.string().optional(),
  /** Only meaningful for `regenerate` — which model writes the new version. */
  model: z.string().optional(),
})

export const reviewStep = createStep({
  id: "review",
  description: "Suspend for scene approval; regenerate anything sent back",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  resumeSchema: z.object({
    decisions: z.array(DecisionSchema),
    /** True once the user is finished and wants the run to continue. */
    done: z.boolean(),
  }),
  suspendSchema: z.object({
    reason: z.literal("review-scenes"),
    scenes: z.array(z.object({ id: z.string(), status: SceneStatusSchema })),
  }),
  execute: async ({ inputData, resumeData, writer, runId, suspend }) => {
    const report = reporter("review", writer)
    const { projectPath } = inputData

    try {
      if (resumeData) {
        await applyDecisions(
          projectPath,
          resumeData.decisions,
          writer as PipelineWriter | undefined,
          report
        )

        if (resumeData.done) {
          await report.done()
          return { projectPath }
        }
      }

      const project = await readStoredProject(projectPath)

      await report.emit("gate", { on: "review-scenes", runId, step: "review" })
      await report.suspended()

      return suspend({
        reason: "review-scenes",
        scenes: project.scenes.map((scene) => ({
          id: scene.id,
          status: scene.status,
        })),
      })
    } catch (error) {
      await report.failed(message(error))
      throw error
    }
  },
})

async function applyDecisions(
  projectPath: string,
  decisions: z.infer<typeof DecisionSchema>[],
  writer: PipelineWriter | undefined,
  report: ReturnType<typeof reporter>
) {
  const project = await readStoredProject(projectPath)
  const byId = new Map(project.scenes.map((scene) => [scene.id, scene]))

  // Approvals and rejections are pure status changes, so they go in one write
  // before any regeneration starts. That way the UI settles immediately and
  // only the scenes actually being redone show as busy.
  const statusChanges = decisions.filter((d) => d.action !== "regenerate")

  if (statusChanges.length > 0) {
    const status = new Map(
      statusChanges.map((d) => [
        d.id,
        d.action === "approve" ? ("approved" as const) : ("rejected" as const),
      ])
    )
    await updateProject(projectPath, (current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        status.has(scene.id)
          ? { ...scene, status: status.get(scene.id)! }
          : scene
      ),
    }))

    for (const change of statusChanges) {
      const scene = byId.get(change.id)
      if (scene) {
        await report.emit(
          "scene",
          {
            ...scene,
            status: status.get(change.id)!,
            html: null,
          },
          { id: scene.id }
        )
      }
    }
  }

  const regenerations = decisions.filter((d) => d.action === "regenerate")

  for (const decision of regenerations) {
    const scene = byId.get(decision.id)
    if (!scene) continue

    // The note and the model ride along on the scene: the note so it reaches
    // the prompt, the model so the generate step writes with it — and both so
    // project.json records what was asked for.
    const requested: StoredScene = {
      ...scene,
      note: decision.note,
      model: decision.model ?? scene.model,
    }

    await report.detail(
      `Regenerating ${scene.id} with ${modelLabel(requested.model ?? SCENE_MODEL)}`
    )
    await generateAndPersistScene(
      { projectPath, scene: requested, styleGuide: project.styleGuide },
      writer
    )
  }
}
