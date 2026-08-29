/**
 * Step 9 — approved scenes to ProRes 4444 with alpha.
 *
 * **Serialized, concurrency 1** (idea.md §6). Chromium frame-stepping plus an
 * ffmpeg encode is enough to saturate a laptop on its own; four of them at once
 * makes the machine unusable while the user is trying to edit in the next
 * window.
 */

import { MIN_SCENE_HOLD_SEC } from "../lib/composite"
import { updatePlanElementLifecycle } from "../lib/editing-plan"
import { sceneExportPath, toRelative } from "../lib/paths"
import { readProject, updateProject } from "../lib/project"
import { exportScene } from "../lib/render"
import type { PipelineWriter } from "../stream/contract"
import { message, reporter, runStep } from "./shared"

/** One progress chunk per this many frames. 210 chunks for a 7s scene is noise. */
const PROGRESS_EVERY = 10

/**
 * `app/api/pipeline/route.ts` calls this for the "Export approved" action —
 * only scenes `approved` with rendered html and no export yet are touched,
 * so scenes already `exported` are left alone.
 */
export async function exportApprovedScenes(
  projectPath: string,
  writer: PipelineWriter | undefined
) {
  const report = reporter("export", writer)

  return runStep(report, async () => {
    const project = await readProject(projectPath)
    const pending = project.scenes.filter(
      (scene) => scene.status === "approved" && scene.html
    )

    if (pending.length === 0) {
      await report.log("No approved scenes to export")
      return { projectPath }
    }

    for (const [index, scene] of pending.entries()) {
      await report.progress(index / pending.length, scene.id)
      await report.emit(
        "scene",
        { ...scene, status: "exporting" },
        { id: scene.id }
      )
      await updateProject(projectPath, (current) => ({
        ...current,
        scenes: current.scenes.map((candidate) =>
          candidate.id === scene.id
            ? { ...candidate, status: "exporting" as const }
            : candidate
        ),
        editingDocument: scene.planElementId
          ? updatePlanElementLifecycle(
              current.editingDocument,
              scene.planElementId,
              { renderStatus: "exporting" }
            )
          : current.editingDocument,
      }))

      const output = sceneExportPath(projectPath, scene.id)
      const durationSec = Math.max(
        scene.measuredDurationSec ?? scene.windowSec,
        MIN_SCENE_HOLD_SEC
      )

      try {
        await exportScene(scene.html!, {
          fps: project.fps,
          durationSec,
          outputPath: output,
          onProgress: async (frame, totalFrames) => {
            if (frame % PROGRESS_EVERY !== 0 && frame !== totalFrames) return
            await report.emit("export", {
              sceneId: scene.id,
              frame,
              totalFrames,
            })
          },
        })

        const exportPath = toRelative(projectPath, output)
        await updateProject(projectPath, (current) => ({
          ...current,
          scenes: current.scenes.map((s) =>
            s.id === scene.id
              ? { ...s, status: "exported" as const, exportPath }
              : s
          ),
          editingDocument: scene.planElementId
            ? updatePlanElementLifecycle(
                current.editingDocument,
                scene.planElementId,
                {
                  renderStatus: "exported",
                  htmlPath: scene.htmlPath,
                  exportPath,
                  renderError: undefined,
                  compositionStatus: "not-composed",
                }
              )
            : current.editingDocument,
        }))

        await report.emit(
          "scene",
          { ...scene, status: "exported", exportPath },
          { id: scene.id }
        )
        await report.log(`${scene.id} → ${exportPath}`)
      } catch (error) {
        // One scene failing to render shouldn't cost the other eleven their
        // exports — the run continues and the failure shows on that scene.
        const reason = message(error)
        await updateProject(projectPath, (current) => ({
          ...current,
          scenes: current.scenes.map((s) =>
            s.id === scene.id
              ? { ...s, status: "failed" as const, error: reason }
              : s
          ),
          editingDocument: scene.planElementId
            ? updatePlanElementLifecycle(
                current.editingDocument,
                scene.planElementId,
                {
                  renderStatus: "failed",
                  renderError: reason,
                  compositionStatus: "not-composed",
                }
              )
            : current.editingDocument,
        }))
        await report.emit(
          "scene",
          { ...scene, status: "failed", error: reason },
          { id: scene.id }
        )
        await report.emit("failure", {
          step: "export",
          message: `${scene.id}: ${reason}`,
          fatal: false,
        })
      }
    }

    return { projectPath }
  })
}
