import type { Segment } from "./segments"
import type { EditingPlanElement, ZoomPreset } from "../schemas"

export const ZOOM_MIN_DURATION_SEC = 0.5
export const ZOOM_MAX_DURATION_SEC = 4

const ZOOM_PRESETS: Record<ZoomPreset, { scale: number; durationSec: number }> =
  {
    subtle: { scale: 1.08, durationSec: 1.5 },
    medium: { scale: 1.15, durationSec: 2 },
    strong: { scale: 1.25, durationSec: 2.5 },
  }

export interface ZoomSettings {
  preset: ZoomPreset
  durationSec: number
  scale: number
}

/** Converts the small preset vocabulary into bounded, deterministic values. */
export function normalizeZoomSettings(
  preset: ZoomPreset = "medium",
  durationSec?: number
): ZoomSettings {
  const settings = ZOOM_PRESETS[preset]
  const duration = durationSec ?? settings.durationSec

  return {
    preset,
    durationSec: Math.min(
      ZOOM_MAX_DURATION_SEC,
      Math.max(ZOOM_MIN_DURATION_SEC, duration)
    ),
    scale: settings.scale,
  }
}

export interface ZoomWindow extends ZoomSettings {
  id: string
  sourceFile: string
  fromSegment: number
  toSegment: number
  scriptStart: number
  scriptEnd: number
}

export interface ZoomPlanResult {
  windows: ZoomWindow[]
  conflicts: string[]
}

/**
 * Turns approved plan elements into source windows. The model's seconds never
 * enter this function: both ends are recovered from approved Segment anchors.
 */
export function approvedZoomWindows(
  elements: EditingPlanElement[],
  segments: Segment[],
  blockers: EditingPlanElement[] = []
): ZoomPlanResult {
  const byIndex = new Map(segments.map((segment) => [segment.index, segment]))
  const approved = elements.filter(
    (element) => element.type === "zoom" && element.status === "approved"
  )
  const conflicts = new Set<string>()
  const windows: ZoomWindow[] = []

  for (const element of approved) {
    const from = byIndex.get(element.fromSegment)
    const to = byIndex.get(element.toSegment)
    if (!from || !to || from.file !== to.file || from.index > to.index) {
      conflicts.add(element.id)
      continue
    }

    const settings = normalizeZoomSettings(
      element.zoomPreset,
      element.zoomDurationSec
    )
    const scriptStart = from.start
    const scriptEnd = Math.min(to.end, scriptStart + settings.durationSec)
    if (scriptEnd <= scriptStart) {
      conflicts.add(element.id)
      continue
    }

    const window: ZoomWindow = {
      id: element.id,
      sourceFile: from.file,
      fromSegment: from.index,
      toSegment: to.index,
      scriptStart,
      scriptEnd,
      ...settings,
    }

    if (
      blockers.some(
        (blocker) =>
          blocker.status === "approved" &&
          blocker.fromSegment <= window.toSegment &&
          blocker.toSegment >= window.fromSegment
      )
    ) {
      conflicts.add(element.id)
      continue
    }

    const overlaps = windows.some(
      (other) =>
        other.sourceFile === window.sourceFile &&
        other.scriptStart < window.scriptEnd &&
        window.scriptStart < other.scriptEnd
    )
    if (overlaps) {
      conflicts.add(element.id)
      continue
    }

    windows.push(window)
  }

  return { windows, conflicts: [...conflicts] }
}
