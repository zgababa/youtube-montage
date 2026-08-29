/**
 * Approve, reject, or regenerate-with-note, per scene (idea.md §10).
 */

import { z } from "zod"

import { readStoredProject, updateProject } from "../lib/project"
import { updatePlanElementLifecycle } from "../lib/editing-plan"
import { modelLabel, SCENE_MODEL } from "../models"
import type { StoredScene } from "../schemas"
import type { PipelineWriter } from "../stream/contract"
import { generateAndPersistScene } from "./generate-scene"
import { reporter } from "./shared"

export const DecisionSchema = z.object({
  id: z.string(),
  action: z.enum(["approve", "reject", "regenerate"]),
  /** Only meaningful for `regenerate` — fed back into the scene prompt. */
  note: z.string().optional(),
  /** Only meaningful for `regenerate` — which model writes the new version. */
  model: z.string().optional(),
})

/**
 * Approve, reject or regenerate a batch of scenes — a direct write, not a
 * workflow resume. `app/api/pipeline/route.ts` calls this for the "Apply
 * scene decisions" action.
 */
export async function applySceneDecisions(
  projectPath: string,
  decisions: z.infer<typeof DecisionSchema>[],
  writer: PipelineWriter | undefined
) {
  const report = reporter("review", writer)
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
      editingDocument: current.editingDocument.elements.reduce(
        (document, element) => {
          const scene = current.scenes.find(
            (candidate) => candidate.planElementId === element.id
          )
          const nextStatus = scene ? status.get(scene.id) : undefined
          if (!scene || !nextStatus) return document
          return updatePlanElementLifecycle(document, element.id, {
            renderStatus: nextStatus === "approved" ? "rendered" : "rejected",
            compositionStatus: "not-composed",
            compositionError: undefined,
          })
        },
        current.editingDocument
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
