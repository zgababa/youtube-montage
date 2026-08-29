/**
 * Renders approved TITRE elements to ProRes 4444 (issue #7).
 *
 * Mirrors `export.ts` exactly, but for title screens instead of generated
 * B-roll scenes: same `exportScene` call, same "one failure doesn't cost the
 * others" handling. The two differences are what makes a title cheaper than
 * a scene — there's no agent call and no measured animation duration, so
 * this step only ever renders the deterministic template
 * (`lib/titles.ts`'s `renderTitleHtml`) for the fixed `TITLE_DURATION_SEC`.
 *
 * `app/api/pipeline/route.ts` calls this for the "Export approved" action,
 * right alongside `exportApprovedScenes` — both render whatever's approved
 * and missing its export, and always run back to back, so one button covers
 * both rather than two nearly-identical ones.
 */

import fs from "node:fs/promises"

import { updatePlanElementLifecycle } from "../lib/editing-plan"
import {
  exportsDir,
  titleExportPath,
  titleHtmlPath,
  titlesDir,
  toRelative,
} from "../lib/paths"
import { readStoredProject, updateProject } from "../lib/project"
import { exportScene } from "../lib/render"
import {
  TITLE_DURATION_SEC,
  renderTitleHtml,
  type TitlePosition,
} from "../lib/titles"
import type { PipelineWriter } from "../stream/contract"
import { message, reporter, runStep } from "./shared"
export async function exportApprovedTitles(
  projectPath: string,
  writer: PipelineWriter | undefined
) {
  const report = reporter("titles", writer)

  return runStep(report, async () => {
    const project = await readStoredProject(projectPath)
    const pending = project.editingDocument.elements.filter(
      (element) =>
        (element.type === "title" || element.type === "lower-third") &&
        element.status === "approved" &&
        element.exportPath == null
    )

    if (pending.length === 0) {
      await report.log("No approved TITRE/LOWER-THIRD elements to render")
      return { projectPath }
    }

    await fs.mkdir(titlesDir(projectPath), { recursive: true })
    await fs.mkdir(exportsDir(projectPath), { recursive: true })

    for (const [index, element] of pending.entries()) {
      await report.progress(index / pending.length, element.id)

      const position: TitlePosition =
        element.type === "lower-third"
          ? "lower-third"
          : element.titlePosition ?? "center"
      const durationSec =
        element.type === "lower-third" ? 4 : TITLE_DURATION_SEC

      const html = renderTitleHtml(
        element.titleText ?? "",
        project.styleGuide,
        position
      )
      const htmlOutput = titleHtmlPath(projectPath, element.id)
      const exportOutput = titleExportPath(projectPath, element.id)

      try {
        await fs.writeFile(htmlOutput, html, "utf8")
        await exportScene(html, {
          fps: project.fps,
          durationSec,
          outputPath: exportOutput,
        })

        const htmlPath = toRelative(projectPath, htmlOutput)
        const exportPath = toRelative(projectPath, exportOutput)
        await updateProject(projectPath, (current) => ({
          ...current,
          editingDocument: updatePlanElementLifecycle(
            current.editingDocument,
            element.id,
            { htmlPath, exportPath }
          ),
        }))

        await report.log(`${element.id} → ${exportPath}`)
      } catch (error) {
        const reason = message(error)
        await report.emit("failure", {
          step: "titles",
          message: `${element.id}: ${reason}`,
          fatal: false,
        })
      }
    }

    return { projectPath }
  })
}
