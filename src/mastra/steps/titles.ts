/**
 * Renders approved TITRE annotations to ProRes 4444 (issue #7).
 *
 * Mirrors `export.ts` exactly, but for title screens instead of generated
 * B-roll scenes: same `exportScene` call, same "one failure doesn't cost the
 * others" handling. The two differences are what makes a title cheaper than
 * a scene — there's no agent call and no measured animation duration, so
 * this step only ever renders the deterministic template
 * (`lib/titles.ts`'s `renderTitleHtml`) for the fixed `TITLE_DURATION_SEC`.
 *
 * Placed in `broll-workflow.ts` right after `exportStep` and before
 * `overlayStep`, so the composite step's existing review gate covers titles
 * too — no new gate needed for a flow this small.
 */

import fs from "node:fs/promises"
import { createStep } from "@mastra/core/workflows"

import {
  exportsDir,
  titleExportPath,
  titleHtmlPath,
  titleElementExportPath,
  titleElementHtmlPath,
  titlesDir,
  toRelative,
} from "../lib/paths"
import { readStoredProject, updateProject } from "../lib/project"
import { exportScene } from "../lib/render"
import { TITLE_DURATION_SEC, renderTitleHtml } from "../lib/titles"
import { PipelineIO, message, reporter, runStep } from "./shared"

export const titlesStep = createStep({
  id: "titles",
  description: "Render approved TITRE annotations to ProRes 4444",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  execute: async ({ inputData, writer }) => {
    const report = reporter("titles", writer)
    const { projectPath } = inputData

    return runStep(report, async () => {
      const project = await readStoredProject(projectPath)
      const pending = project.titleAnnotations.filter(
        (annotation) =>
          annotation.status === "approved" && annotation.exportPath === null
      )
      const pendingPlanTitles = project.editingDocument.elements.filter(
        (element) =>
          element.type === "title" &&
          element.status === "approved" &&
          element.titleText &&
          element.exportPath == null
      )

      if (pending.length === 0 && pendingPlanTitles.length === 0) {
        await report.log("No approved title annotations to render")
        return { projectPath }
      }

      await fs.mkdir(titlesDir(projectPath), { recursive: true })
      await fs.mkdir(exportsDir(projectPath), { recursive: true })

      for (const [index, element] of pendingPlanTitles.entries()) {
        await report.progress(
          (pending.length + index) /
            Math.max(1, pending.length + pendingPlanTitles.length),
          element.id
        )

        const html = renderTitleHtml(element.titleText!, project.styleGuide)
        const htmlOutput = titleElementHtmlPath(projectPath, element.id)
        const exportOutput = titleElementExportPath(projectPath, element.id)

        try {
          await fs.writeFile(htmlOutput, html, "utf8")
          await exportScene(html, {
            fps: project.fps,
            durationSec: TITLE_DURATION_SEC,
            outputPath: exportOutput,
          })

          const htmlPath = toRelative(projectPath, htmlOutput)
          const exportPath = toRelative(projectPath, exportOutput)
          await updateProject(projectPath, (current) => ({
            ...current,
            editingDocument: {
              ...current.editingDocument,
              elements: current.editingDocument.elements.map((candidate) =>
                candidate.id === element.id &&
                candidate.status === "approved" &&
                candidate.titleText === element.titleText
                  ? {
                      ...candidate,
                      htmlPath,
                      exportPath,
                      composed: false,
                      timelineOffsetSec: null,
                      timelineDurationSec: TITLE_DURATION_SEC,
                    }
                  : candidate
              ),
            },
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

      for (const [index, annotation] of pending.entries()) {
        await report.progress(index / pending.length, annotation.id)

        const html = renderTitleHtml(annotation.text, project.styleGuide)
        const htmlOutput = titleHtmlPath(projectPath, annotation.id)
        const exportOutput = titleExportPath(projectPath, annotation.id)

        try {
          await fs.writeFile(htmlOutput, html, "utf8")
          await exportScene(html, {
            fps: project.fps,
            durationSec: TITLE_DURATION_SEC,
            outputPath: exportOutput,
          })

          const htmlPath = toRelative(projectPath, htmlOutput)
          const exportPath = toRelative(projectPath, exportOutput)
          await updateProject(projectPath, (current) => ({
            ...current,
            titleAnnotations: current.titleAnnotations.map((a) =>
              a.id === annotation.id ? { ...a, htmlPath, exportPath } : a
            ),
          }))

          await report.log(`${annotation.id} → ${exportPath}`)
        } catch (error) {
          const reason = message(error)
          await report.emit("failure", {
            step: "titles",
            message: `${annotation.id}: ${reason}`,
            fatal: false,
          })
        }
      }

      return { projectPath }
    })
  },
})
