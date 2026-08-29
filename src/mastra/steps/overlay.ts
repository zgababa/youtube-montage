/**
 * Step 10 — composite the exported scenes into `timeline.fcpxml`, then
 * suspend for approval.
 *
 * `timelineStep` (gate 2) already wrote a first `timeline.fcpxml` — cut only,
 * before scenes existed, on purpose (ADR 0002: a user who only wants the cut
 * gets it without paying for scene generation). This step rewrites the same
 * file, now with each exported scene as a connected clip backed by a plain
 * white clip (`white-backing.ts`) so it reads as a full-frame cutaway rather
 * than a transparent overlay — see `fcpxml.ts` for how a scene's `scriptStart`
 * becomes a connected clip's `offset`.
 *
 * A fourth gate rather than a silent rewrite (idea.md §4.2 covers the other
 * three): the same file the earlier gate already had you review is about to
 * change again, this time after every step that isn't just a formatting
 * pass. Regenerate is offered even though the compositing is deterministic —
 * this is where a scene that got manually re-exported outside a normal run
 * would show up.
 */

import fs from "node:fs/promises"
import { createStep } from "@mastra/core/workflows"
import { z } from "zod"

import { buildCompositeOverlays } from "../lib/composite"
import { buildFcpxml, buildTimelineLayout, placeOverlays } from "../lib/fcpxml"
import { fcpxmlPath } from "../lib/paths"
import { readStoredProject, updateProject } from "../lib/project"
import { ensureWhiteBacking } from "../lib/white-backing"
import type { StoredProject } from "../schemas"
import { PipelineIO, message, reporter } from "./shared"

export const overlayStep = createStep({
  id: "overlay",
  description:
    "Composite exported scenes into timeline.fcpxml, then suspend for approval",
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
      const stats = await writeComposite(project)

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

/** Rebuilds the runs, recomposits the exported scenes and titles, and rewrites `timeline.fcpxml`. */
async function writeComposite(project: StoredProject) {
  const { runs, overlays, titleInsertions } = buildCompositeOverlays(project)
  const { placed, skipped: skippedOverlays } = placeOverlays(runs, overlays)
  const layout = buildTimelineLayout(runs, titleInsertions, project.fps)

  // Only encoded when there's actually something to back — a project with
  // scenes rejected outright never needs the clip at all.
  const whiteBacking =
    placed.length > 0
      ? await ensureWhiteBacking(
          project.path,
          project.fps,
          Math.max(...placed.map((fragment) => fragment.durationSec))
        )
      : null

  const xml = buildFcpxml(
    project,
    runs,
    overlays,
    whiteBacking,
    titleInsertions
  )
  const file = fcpxmlPath(project.path)
  await fs.writeFile(file, xml, "utf8")

  const titlePlacements = new Map(
    layout.titlePlacements.map((title) => [title.id, title])
  )
  await updateProject(project.path, (current) => ({
    ...current,
    editingDocument: {
      ...current.editingDocument,
      elements: current.editingDocument.elements.map((element) => {
        if (
          element.type !== "title" ||
          element.source === "manual" ||
          element.exportPath == null
        ) {
          return element
        }
        const placement = titlePlacements.get(element.id)
        if (!placement) {
          return {
            ...element,
            composed: false,
            timelineOffsetSec: null,
          }
        }
        return {
          ...element,
          composed: true,
          timelineOffsetSec: placement.timelineOffsetSec,
          timelineDurationSec: placement.durationSec,
        }
      }),
    },
  }))

  // A scene split across a run boundary produces more than one fragment —
  // count distinct scenes, not fragments, so the UI reports "10 scenes"
  // rather than however many pieces they happened to break into.
  const placedCount = new Set(placed.map((fragment) => fragment.sceneId)).size

  return {
    path: file,
    placedCount,
    skipped: [...skippedOverlays, ...layout.skippedTitles],
  }
}
