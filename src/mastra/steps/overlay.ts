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

import { buildFcpxml, placeOverlays, type OverlayScene } from "../lib/fcpxml"
import { fcpxmlPath } from "../lib/paths"
import { readStoredProject, updateProject } from "../lib/project"
import { buildSegments } from "../lib/segments"
import { composableTitleOverlays } from "../lib/titles"
import { buildKeptRuns } from "../lib/timeline"
import { ensureWhiteBacking } from "../lib/white-backing"
import type { StoredProject } from "../schemas"
import { MIN_SCENE_HOLD_SEC } from "./export"
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

/** Rebuilds the runs, recomposits the exported scenes, and rewrites `timeline.fcpxml`. */
async function writeComposite(project: StoredProject) {
  const exported = project.scenes.filter(
    (scene) => scene.status === "exported" && scene.exportPath !== null
  )

  const segments = buildSegments(project.transcript.words)
  const runs = buildKeptRuns(
    segments,
    project.spans,
    project.media,
    project.maxSilenceSec
  )

  // Matches the floor `export.ts` renders to — the composited duration has
  // to agree with what the .mov actually contains, or the fragment plays
  // past the end of its own asset.
  const sceneOverlays: OverlayScene[] = exported.map((scene) => ({
    id: scene.id,
    sourceFile: scene.sourceFile,
    scriptStart: scene.scriptStart,
    durationSec: Math.max(
      scene.measuredDurationSec ?? scene.windowSec,
      MIN_SCENE_HOLD_SEC
    ),
    exportPath: scene.exportPath!,
  }))

  // Manual TITRE annotations composite exactly like a scene (issue #7):
  // `composableTitleOverlays` projects the rendered, approved ones to the
  // same shape, so `placeOverlays`/`buildFcpxml` don't need to know titles
  // exist at all.
  const overlays = [
    ...sceneOverlays,
    ...composableTitleOverlays(project.titleAnnotations),
  ]

  const { placed, skipped } = placeOverlays(runs, overlays)

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

  const xml = buildFcpxml(project, runs, overlays, whiteBacking)
  const file = fcpxmlPath(project.path)
  await fs.writeFile(file, xml, "utf8")

  // A scene split across a run boundary produces more than one fragment —
  // count distinct scenes, not fragments, so the UI reports "10 scenes"
  // rather than however many pieces they happened to break into.
  const placedCount = new Set(placed.map((fragment) => fragment.sceneId)).size

  return { path: file, placedCount, skipped }
}
