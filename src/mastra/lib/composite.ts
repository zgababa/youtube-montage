/**
 * The overlays a build of `timeline.fcpxml` would be handed: every exported
 * scene and every composable TITRE annotation (issue #7), projected to the
 * same `OverlayScene` shape and laid against the same kept runs.
 *
 * One definition, used both by the `overlay` step that actually writes the
 * file (`steps/overlay.ts`) and by the editing document that reports
 * whether an annotation made it in (`lib/project.ts`'s `buildEditingDocument`).
 * Two call sites independently recomputing "runs" and "what's composable"
 * is exactly how the document ends up claiming a composition the export
 * doesn't contain.
 */

import { type OverlayScene, type TimelineTitleInsertion } from "./fcpxml"
import { buildSegments, keptSegments } from "./segments"
import { composableTitleOverlays, TITLE_DURATION_SEC } from "./titles"
import { buildKeptRuns, type TimelineRun } from "./timeline"
import type { StoredProject } from "../schemas"

/**
 * Floor on how long an exported scene plays, in seconds.
 *
 * A scene's own choreography routinely finishes well under its available
 * window — `animation-fill-mode: both` (`scene-agent.ts`) holds the last
 * frame once it does, so exporting past the measured animation just renders
 * more of that held frame, for free. Four seconds reads as a deliberate
 * cutaway rather than a flash. Lives here, not in `steps/export.ts`, so both
 * the step that renders to this floor and the step that composites against
 * it share one constant rather than one importing it from the other.
 */
export const MIN_SCENE_HOLD_SEC = 4

export interface CompositeOverlays {
  runs: TimelineRun[]
  overlays: OverlayScene[]
  titleInsertions: TimelineTitleInsertion[]
}

/** The kept runs, plus every scene and TITRE annotation ready to composite. */
export function buildCompositeOverlays(
  project: StoredProject
): CompositeOverlays {
  const segments = buildSegments(project.transcript.words)
  const kept = keptSegments(segments, project.spans)
  const runs = buildKeptRuns(
    segments,
    project.spans,
    project.media,
    project.maxSilenceSec
  )

  const exportedScenes = project.scenes.filter(
    (scene) => scene.status === "exported" && scene.exportPath !== null
  )
  const sceneOverlays: OverlayScene[] = exportedScenes.map((scene) => ({
    id: scene.id,
    sourceFile: scene.sourceFile,
    scriptStart: scene.scriptStart,
    durationSec: Math.max(
      scene.measuredDurationSec ?? scene.windowSec,
      MIN_SCENE_HOLD_SEC
    ),
    exportPath: scene.exportPath!,
  }))

  const overlays = [
    ...sceneOverlays,
    ...composableTitleOverlays(project.titleAnnotations),
  ]

  const bySegmentIndex = new Map(
    kept.map((segment) => [segment.index, segment])
  )
  const titleInsertions = project.editingDocument.elements.flatMap(
    (element) => {
      if (
        element.type !== "title" ||
        element.source === "manual" ||
        element.status !== "approved" ||
        !element.exportPath
      ) {
        return []
      }
      const anchor = bySegmentIndex.get(element.fromSegment)
      if (!anchor) return []
      return [
        {
          id: element.id,
          sourceFile: anchor.file,
          scriptStart: anchor.start,
          durationSec: TITLE_DURATION_SEC,
          exportPath: element.exportPath,
        },
      ]
    }
  )

  return { runs, overlays, titleInsertions }
}
