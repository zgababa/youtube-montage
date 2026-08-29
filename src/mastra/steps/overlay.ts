/**
 * Composite the exported scenes into `timeline.fcpxml`.
 *
 * `writeTimeline` (`timeline.ts`) already wrote a first `timeline.fcpxml` —
 * cut only, before scenes existed, on purpose (ADR 0002: a user who only
 * wants the cut gets it without paying for scene generation). This rewrites
 * the same file, now with each exported scene as a connected clip backed by
 * a plain white clip (`white-backing.ts`) so it reads as a full-frame
 * cutaway rather than a transparent overlay — see `fcpxml.ts` for how a
 * scene's `scriptStart` becomes a connected clip's `offset`.
 *
 * No gate here (ADR 0009): compositing is deterministic — same inputs,
 * same file, every time. Called by the plain "update timeline" action
 * (`app/api/projects/[id]/timeline/route.ts`) whenever a scene gets
 * exported.
 */

import fs from "node:fs/promises"

import { buildCompositeOverlays } from "../lib/composite"
import { sceneRenderStatus } from "../lib/editing-plan"
import {
  buildFcpxml,
  placeOverlays,
  placeZooms,
  defaultSfxDuration,
  type TransitionSpec,
  type SfxClip,
} from "../lib/fcpxml"
import { fcpxmlPath } from "../lib/paths"
import { updateProject } from "../lib/project"
import { buildSegments, keptSegments } from "../lib/segments"
import { ensureWhiteBacking } from "../lib/white-backing"
import { approvedZoomWindows } from "../lib/zooms"
import type { StoredProject, SfxType, TransitionType } from "../schemas"
import type { PlanElementType } from "../schemas"

function resolveSfxType(
  elementType: PlanElementType,
  transitionType?: TransitionType
): SfxType | null {
  switch (elementType) {
    case "transition":
      if (
        transitionType?.startsWith("wipe-") ||
        transitionType?.startsWith("push-")
      ) {
        return "swoosh"
      }
      if (transitionType === "dip-to-black") return "thud"
      return "transition"
    case "zoom":
      return "whoosh"
    case "scene":
      return "pop"
    default:
      return null
  }
}

/**
 * Rebuilds the runs, recomposits the exported scenes and titles, and
 * rewrites `timeline.fcpxml`. Also called directly, outside the workflow,
 * by the plain "update timeline" action.
 */
export async function writeComposite(project: StoredProject) {
  const { runs, overlays } = buildCompositeOverlays(project)
  const { placed, skipped, truncated } = placeOverlays(runs, overlays)

  // Zooms are a transform on the source clip itself, not an overlay asset —
  // so an approved zoom that collides with an approved title or scene at the
  // same moment can't share the frame with it. Reported as a conflict rather
  // than picking a winner silently.
  const segments = keptSegments(
    buildSegments(project.transcript.words),
    project.spans
  )
  const { windows: zooms, conflicts: zoomConflicts } = approvedZoomWindows(
    project.editingDocument.elements,
    segments,
    project.editingDocument.elements.filter(
      (element) =>
        element.status === "approved" &&
        (element.type === "title" ||
          element.type === "scene" ||
          element.type === "lower-third")
    )
  )
  const { placed: placedZooms, skipped: skippedZooms } = placeZooms(runs, zooms)

  // Build transitions from approved transition elements in the editing plan.
  const transitionElements = project.editingDocument.elements.filter(
    (element) =>
      element.type === "transition" && element.status === "approved"
  )
  const transitions: TransitionSpec[] = transitionElements
    .map((element) => {
      // Find the run that contains the element's fromSegment.
      const segment = segments.find((s) => s.index === element.fromSegment)
      if (!segment) return null
      const runIndex = runs.findIndex(
        (run) =>
          run.file === segment.file &&
          segment.start >= run.sourceStart &&
          segment.start < run.sourceEnd
      )
      if (runIndex <= 0) return null
      return {
        runIndex,
        type: element.transitionType ?? "crossfade",
        durationSec: 0.5,
      }
    })
    .filter((t): t is TransitionSpec => t !== null)

  // Build SFX clips from approved plan elements whose visuals are placed.
  const placedElementIds = new Set([
    ...placed.map((fragment) => fragment.sceneId),
    ...placedZooms.map((fragment) => fragment.zoomId),
  ])
  const composedTitleIds = new Set(
    project.editingDocument.elements
      .filter(
        (element) =>
          (element.type === "title" || element.type === "lower-third") &&
          element.compositionStatus === "composed"
      )
      .map((element) => element.id)
  )
  const sfxClips: SfxClip[] = []
  for (const element of project.editingDocument.elements) {
    if (element.status !== "approved") continue

    const hasVisual =
      placedElementIds.has(element.id) ||
      placedElementIds.has(element.sceneId ?? "") ||
      composedTitleIds.has(element.id)
    if (!hasVisual) continue

    const sfxType = resolveSfxType(element.type, element.transitionType)
    if (!sfxType && !element.sfxType) continue

    const resolvedType = element.sfxType ?? sfxType
    if (!resolvedType) continue

    const segment = segments.find((s) => s.index === element.fromSegment)
    if (!segment) continue
    const runIndex = runs.findIndex(
      (run) =>
        run.file === segment.file &&
        segment.start >= run.sourceStart &&
        segment.start < run.sourceEnd
    )
    if (runIndex === -1) continue

    sfxClips.push({
      sfxType: resolvedType,
      runIndex,
      runOffset: segment.start,
      durationSec: defaultSfxDuration(resolvedType),
      planElementId: element.id,
    })
  }

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

  const xml = buildFcpxml(project, runs, overlays, whiteBacking, zooms, transitions, sfxClips)
  const file = fcpxmlPath(project.path)
  await fs.writeFile(file, xml, "utf8")

  const placedIds = new Set(placed.map((fragment) => fragment.sceneId))
  const skippedIds = new Set(skipped)
  const truncatedIds = new Set(truncated)
  const composedZoomIds = new Set(
    placedZooms.map((fragment) => fragment.zoomId)
  )
  const failedZoomIds = new Set([...zoomConflicts, ...skippedZooms])
  const compositionFor = (id: string) => {
    if (skippedIds.has(id)) {
      return {
        compositionStatus: "placement-failed" as const,
        compositionError:
          "The exported scene could not be placed in the approved runs.",
      }
    }
    if (truncatedIds.has(id)) {
      return {
        compositionStatus: "partially-composed" as const,
        compositionError:
          "The scene ran out of kept footage before its full window.",
      }
    }
    if (placedIds.has(id)) {
      return {
        compositionStatus: "composed" as const,
        compositionError: undefined,
      }
    }
    return null
  }
  await updateProject(project.path, (current) => ({
    ...current,
    editingDocument: {
      ...current.editingDocument,
      elements: current.editingDocument.elements.map((element) => {
        if (element.type === "scene" && element.sceneId) {
          const scene = current.scenes.find(
            (candidate) => candidate.id === element.sceneId
          )
          const next = {
            ...element,
            ...(scene
              ? {
                  renderStatus: sceneRenderStatus(scene),
                  htmlPath: scene.htmlPath,
                  exportPath: scene.exportPath,
                  ...(scene.error ? { renderError: scene.error } : {}),
                }
              : {}),
          }
          return { ...next, ...(compositionFor(element.sceneId) ?? {}) }
        }
        // A title or lower-third has no separate `StoredScene` — the overlay
        // `id` fed to `placeOverlays` is the element's own id.
        if (
          (element.type === "title" || element.type === "lower-third") &&
          element.exportPath
        ) {
          return { ...element, ...(compositionFor(element.id) ?? {}) }
        }
        // A zoom has no export of its own either — it's a transform applied
        // directly to the source clip, stamped straight from `placeZooms`.
        if (element.type === "zoom" && element.status === "approved") {
          if (composedZoomIds.has(element.id)) {
            return { ...element, compositionStatus: "composed" as const }
          }
          if (failedZoomIds.has(element.id)) {
            return {
              ...element,
              status: "conflict" as const,
              compositionStatus: "placement-failed" as const,
              compositionError:
                "This zoom collides with an approved title or scene, or falls outside the kept footage.",
            }
          }
        }
        return element
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
    skipped: [...skipped, ...zoomConflicts, ...skippedZooms],
  }
}
