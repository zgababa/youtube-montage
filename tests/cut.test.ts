import { describe, expect, test } from "bun:test"

import { buildCutPlan } from "../src/mastra/lib/cut"
import type { MediaFile, StoredProject, Word } from "../src/mastra/schemas"

function word(w: string, start: number, end: number, file = "raw/a.mp4"): Word {
  return { w, start, end, file }
}

function media(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    path: "raw/a.mp4",
    durationSec: 120,
    hasAudio: true,
    hasVideo: true,
    transcribe: true,
    offsetSec: 0,
    voices: null,
    ...overrides,
  }
}

function project(overrides: Partial<StoredProject> = {}): StoredProject {
  return {
    version: 1,
    id: "proj_1",
    path: "/projects/demo",
    name: "Demo",
    createdAt: new Date().toISOString(),
    fps: 30,
    media: [media()],
    transcriptionHints: { prompt: "", keyterms: [] },
    transcript: { words: [] },
    spans: [],
    cleanupApprovedAt: null,
    maxSilenceSec: 0.3,
    timelineApprovedAt: null,
    compositeApprovedAt: null,
    styleGuide: { palette: [], fontStack: "", motion: "", notes: "" },
    styleRef: "default",
    scenes: [],
    copy: null,
    ...overrides,
  }
}

describe("buildCutPlan", () => {
  test("throws when cleanup hasn't been approved", () => {
    const p = project({
      cleanupApprovedAt: null,
      transcript: { words: [word("hi", 0, 1)] },
      spans: [{ start: 0, end: 1, action: "keep" }],
    })

    expect(() => buildCutPlan(p)).toThrow()
  })

  test("a kept stretch with a cut in the middle produces two ordered segments", () => {
    // Four words, each its own segment: a 0.6s+ gap between every one of them
    // (`buildSegments`' PAUSE_SEC) keeps them from merging into one segment
    // that a mid-segment span couldn't cut cleanly.
    const words = [
      word("a", 0, 1),
      word("b", 1.6, 2.6),
      word("c", 3.2, 4.2),
      word("d", 4.9, 5.9),
    ]
    const p = project({
      cleanupApprovedAt: "2026-01-01T00:00:00.000Z",
      transcript: { words },
      spans: [
        { start: 0, end: 1, action: "keep" },
        { start: 1.6, end: 4.2, action: "cut", category: "filler" },
        { start: 4.9, end: 5.9, action: "keep" },
      ],
    })

    const plan = buildCutPlan(p)

    expect(plan).toEqual([
      { sourcePath: "/projects/demo/raw/a.mp4", file: "raw/a.mp4", sourceStart: 0, sourceEnd: 1 },
      { sourcePath: "/projects/demo/raw/a.mp4", file: "raw/a.mp4", sourceStart: 4.9, sourceEnd: 5.9 },
    ])
  })

  test("cutting everything produces an explicitly empty plan, not an error", () => {
    const words = [word("a", 0, 1)]
    const p = project({
      cleanupApprovedAt: "2026-01-01T00:00:00.000Z",
      transcript: { words },
      spans: [{ start: 0, end: 1, action: "cut", category: "filler" }],
    })

    expect(buildCutPlan(p)).toEqual([])
  })

  test("preserves script order across multiple source files", () => {
    const words = [
      word("a", 0, 1, "raw/01 - a.mp4"),
      word("b", 0, 1, "raw/02 - b.mp4"),
    ]
    const p = project({
      cleanupApprovedAt: "2026-01-01T00:00:00.000Z",
      transcript: { words },
      spans: [{ start: 0, end: 1, action: "keep" }],
      media: [
        media({ path: "raw/01 - a.mp4" }),
        media({ path: "raw/02 - b.mp4" }),
      ],
    })

    const plan = buildCutPlan(p)

    expect(plan.map((segment) => segment.file)).toEqual([
      "raw/01 - a.mp4",
      "raw/02 - b.mp4",
    ])
    expect(plan.map((segment) => segment.sourcePath)).toEqual([
      "/projects/demo/raw/01 - a.mp4",
      "/projects/demo/raw/02 - b.mp4",
    ])
  })

  test("resolves the source path from an absolute project path", () => {
    const words = [word("a", 0, 1)]
    const p = project({
      path: "/elsewhere/proj",
      cleanupApprovedAt: "2026-01-01T00:00:00.000Z",
      transcript: { words },
      spans: [{ start: 0, end: 1, action: "keep" }],
    })

    const plan = buildCutPlan(p)

    expect(plan[0].sourcePath).toBe("/elsewhere/proj/raw/a.mp4")
  })
})
