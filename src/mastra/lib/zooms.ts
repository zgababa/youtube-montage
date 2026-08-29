import type { Segment } from "./segments"
import type {
  EditingPlanElement,
  ZoomPreset,
  ZoomPosition,
} from "../schemas"

export const ZOOM_MIN_DURATION_SEC = 0.5
export const ZOOM_MAX_DURATION_SEC = 4

export interface ZoomPresetConfig {
  scale: number
  durationSec: number
  /** Default position for this preset — overridable per element. */
  position: ZoomPosition
}

const ZOOM_PRESETS: Record<ZoomPreset, ZoomPresetConfig> = {
  subtle: { scale: 1.08, durationSec: 1.5, position: "center" },
  medium: { scale: 1.15, durationSec: 2, position: "center" },
  strong: { scale: 1.25, durationSec: 2.5, position: "center" },
}

/**
 * Position offsets in FCPXML coordinate space (pixels from center).
 * 1920×1080 frame, origin at center — positive X is right, positive Y is down.
 */
const ZOOM_POSITION_OFFSETS: Record<ZoomPosition, { x: number; y: number }> = {
  center: { x: 0, y: 0 },
  top: { x: 0, y: -200 },
  bottom: { x: 0, y: 200 },
  left: { x: -300, y: 0 },
  right: { x: 300, y: 0 },
  "top-left": { x: -250, y: -180 },
  "top-right": { x: 250, y: -180 },
  "bottom-left": { x: -250, y: 180 },
  "bottom-right": { x: 250, y: 180 },
}

export function zoomPositionOffset(
  position: ZoomPosition = "center"
): { x: number; y: number } {
  return ZOOM_POSITION_OFFSETS[position]
}

export interface ZoomSettings {
  preset: ZoomPreset
  durationSec: number
  scale: number
  position: ZoomPosition
}

/** Converts the small preset vocabulary into bounded, deterministic values. */
export function normalizeZoomSettings(
  preset: ZoomPreset = "medium",
  durationSec?: number,
  position?: ZoomPosition
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
    position: position ?? settings.position,
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
      element.zoomDurationSec,
      element.zoomPosition
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
