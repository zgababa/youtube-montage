import { describe, expect, test } from "bun:test"

import {
  ZOOM_MAX_DURATION_SEC,
  ZOOM_MIN_DURATION_SEC,
  approvedZoomWindows,
  normalizeZoomSettings,
} from "../src/mastra/lib/zooms"
import { placeZooms } from "../src/mastra/lib/fcpxml"
import type { EditingPlanElement } from "../src/mastra/schemas"
import type { Segment } from "../src/mastra/lib/segments"
import type { TimelineRun } from "../src/mastra/lib/timeline"

describe("normalizeZoomSettings", () => {
  test("maps each bounded preset to a deterministic scale", () => {
    expect(normalizeZoomSettings("subtle", 1.5)).toEqual({
      preset: "subtle",
      durationSec: 1.5,
      scale: 1.08,
    })
    expect(normalizeZoomSettings("medium", 2)).toEqual({
      preset: "medium",
      durationSec: 2,
      scale: 1.15,
    })
    expect(normalizeZoomSettings("strong", 3)).toEqual({
      preset: "strong",
      durationSec: 3,
      scale: 1.25,
    })
  })

  test("bounds an editable duration instead of accepting free-form keyframes", () => {
    expect(normalizeZoomSettings("medium", 0.01).durationSec).toBe(
      ZOOM_MIN_DURATION_SEC
    )
    expect(normalizeZoomSettings("medium", 99).durationSec).toBe(
      ZOOM_MAX_DURATION_SEC
    )
    expect(normalizeZoomSettings("medium").durationSec).toBe(2)
  })
})

function element(
  overrides: Partial<EditingPlanElement> = {}
): EditingPlanElement {
  return {
    id: "zoom-1",
    sectionId: "section-1",
    type: "zoom",
    source: "automatic",
    status: "approved",
    fromSegment: 2,
    toSegment: 4,
    reason: "salient moment",
    zoomPreset: "medium",
    zoomDurationSec: 2,
    ...overrides,
  }
}

function segment(index: number, start: number, file = "raw/01.mp4"): Segment {
  return {
    index,
    start,
    end: start + 1,
    text: `segment ${index}`,
    file,
  }
}

describe("approvedZoomWindows", () => {
  test("anchors an approved zoom to Segment source times and ignores proposals", () => {
    const result = approvedZoomWindows(
      [
        element({ id: "proposed", status: "proposed" }),
        element({ id: "accepted", fromSegment: 2, toSegment: 4 }),
      ],
      [segment(2, 10), segment(4, 20)]
    )

    expect(result.conflicts).toEqual([])
    expect(result.windows).toEqual([
      expect.objectContaining({
        id: "accepted",
        sourceFile: "raw/01.mp4",
        fromSegment: 2,
        toSegment: 4,
        scriptStart: 10,
        scriptEnd: 12,
        preset: "medium",
      }),
    ])
  })

  test("reports collisions with an approved title or scene instead of stacking silently", () => {
    const result = approvedZoomWindows(
      [element()],
      [segment(2, 10), segment(4, 20)],
      [
        element({
          id: "title-1",
          type: "title",
          fromSegment: 3,
          toSegment: 3,
        }),
      ]
    )

    expect(result.windows).toEqual([])
    expect(result.conflicts).toEqual(["zoom-1"])
  })
})

describe("placeZooms", () => {
  test("keeps source anchoring when the approved window crosses a cut/run boundary", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01.mp4", sourceStart: 0, sourceEnd: 5 },
      { file: "raw/01.mp4", sourceStart: 10, sourceEnd: 15 },
    ]

    const { placed, skipped } = placeZooms(runs, [
      {
        id: "zoom-1",
        sourceFile: "raw/01.mp4",
        fromSegment: 2,
        toSegment: 4,
        scriptStart: 4,
        scriptEnd: 12,
        preset: "medium",
        durationSec: 8,
        scale: 1.15,
      },
    ])

    expect(skipped).toEqual([])
    expect(placed).toEqual([
      expect.objectContaining({
        zoomId: "zoom-1",
        runIndex: 0,
        runOffset: 4,
        durationSec: 1,
      }),
      expect.objectContaining({
        zoomId: "zoom-1",
        runIndex: 1,
        runOffset: 10,
        durationSec: 2,
      }),
    ])
  })
})
