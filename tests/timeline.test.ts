import { describe, expect, test } from "bun:test"

import {
  BeatSheetTimingError,
  buildKeptRuns,
  remapBeatSheetTiming,
} from "../src/mastra/lib/timeline"
import type { TimelineRun } from "../src/mastra/lib/timeline"
import type { Segment } from "../src/mastra/lib/segments"
import type { MediaFile, Span } from "../src/mastra/schemas"

/** One segment, one word's worth, on a given file. */
function segment(
  index: number,
  start: number,
  end: number,
  file = "raw/a.mp4"
): Segment {
  return { index, start, end, text: `seg${index}`, file }
}

function media(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    path: "raw/a.mp4",
    durationSec: 100,
    hasAudio: true,
    hasVideo: true,
    transcribe: true,
    offsetSec: 0,
    voices: null,
    ...overrides,
  }
}

describe("buildKeptRuns", () => {
  test("a cut in the middle of one file produces two runs", () => {
    // Four segments on the same file, seconds apart; the middle two are cut.
    const segments = [
      segment(0, 0, 1),
      segment(1, 1, 2),
      segment(2, 2, 3),
      segment(3, 3, 4),
    ]
    const spans: Span[] = [
      { start: 0, end: 1, action: "keep" },
      { start: 1, end: 3, action: "cut", category: "filler" },
      { start: 3, end: 4, action: "keep" },
    ]

    const runs = buildKeptRuns(segments, spans, [media()])

    expect(runs).toHaveLength(2)
    expect(runs[0]).toEqual({ file: "raw/a.mp4", sourceStart: 0, sourceEnd: 1 })
    expect(runs[1]).toEqual({ file: "raw/a.mp4", sourceStart: 3, sourceEnd: 4 })
  })

  test("two files back to back with no cut between them stay two runs", () => {
    // Numbered filenames, like the fork's own 6-file project: the naming
    // convention is what tells the guard below this is a sequential script,
    // not simultaneous multi-camera footage.
    const segments = [
      segment(0, 0, 1, "raw/01 - a.mp4"),
      segment(1, 1, 2, "raw/01 - a.mp4"),
      segment(2, 0, 1, "raw/02 - b.mp4"),
      segment(3, 1, 2, "raw/02 - b.mp4"),
    ]
    // Everything kept — nothing cut anywhere.
    const spans: Span[] = [{ start: 0, end: 2, action: "keep" }]

    const runs = buildKeptRuns(segments, spans, [
      media({ path: "raw/01 - a.mp4" }),
      media({ path: "raw/02 - b.mp4" }),
    ])

    expect(runs).toHaveLength(2)
    expect(runs[0].file).toBe("raw/01 - a.mp4")
    expect(runs[1].file).toBe("raw/02 - b.mp4")
  })

  test("a fully kept single file is one run covering it entirely", () => {
    const segments = [segment(0, 0, 1), segment(1, 1, 2), segment(2, 2, 3)]
    const spans: Span[] = [{ start: 0, end: 3, action: "keep" }]

    const runs = buildKeptRuns(segments, spans, [media()])

    expect(runs).toHaveLength(1)
    expect(runs[0]).toEqual({ file: "raw/a.mp4", sourceStart: 0, sourceEnd: 3 })
  })

  test("a long natural pause inside one file is capped to a short lead-in", () => {
    // No cut anywhere — both segments are kept — but 3s of silence separates
    // them, well past MAX_SILENCE_SEC. Nothing in `cleanup` flagged this gap,
    // so `buildKeptRuns` is the only place left to shorten it.
    const segments = [segment(0, 0, 1), segment(1, 4, 5)]
    const spans: Span[] = [{ start: 0, end: 5, action: "keep" }]

    const runs = buildKeptRuns(segments, spans, [media()])

    expect(runs).toHaveLength(2)
    expect(runs[0]).toEqual({ file: "raw/a.mp4", sourceStart: 0, sourceEnd: 1 })
    // Only the last 0.3s of the 3s gap survives, right before segment 1.
    expect(runs[1]).toEqual({
      file: "raw/a.mp4",
      sourceStart: 3.7,
      sourceEnd: 5,
    })
  })

  test("a short natural pause inside one file is left untouched", () => {
    // 0.2s between segments — well under MAX_SILENCE_SEC — stays as one run.
    const segments = [segment(0, 0, 1), segment(1, 1.2, 2)]
    const spans: Span[] = [{ start: 0, end: 2, action: "keep" }]

    const runs = buildKeptRuns(segments, spans, [media()])

    expect(runs).toHaveLength(1)
    expect(runs[0]).toEqual({ file: "raw/a.mp4", sourceStart: 0, sourceEnd: 2 })
  })

  test("an explicit maxSilenceSec overrides the default", () => {
    // Same 3s gap as the capping test above, but called with a 1s cap instead
    // of the 0.3s default — locks in that the parameter is actually read.
    const segments = [segment(0, 0, 1), segment(1, 4, 5)]
    const spans: Span[] = [{ start: 0, end: 5, action: "keep" }]

    const runs = buildKeptRuns(segments, spans, [media()], 1)

    expect(runs).toHaveLength(2)
    expect(runs[1]).toEqual({ file: "raw/a.mp4", sourceStart: 3, sourceEnd: 5 })
  })

  test("throws when multiple files are transcribed with no identified mic", () => {
    const segments = [segment(0, 0, 1, "raw/a.mp4")]
    const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]

    const ambiguousMedia = [
      media({ path: "raw/cam-left.mp4", transcribe: true, voices: null }),
      media({ path: "raw/cam-right.mp4", transcribe: true, voices: null }),
    ]

    expect(() => buildKeptRuns(segments, spans, ambiguousMedia)).toThrow()
  })

  test("does not throw when the ambiguous files are a numbered sequence", () => {
    // Same shape autoPair leaves multiple simultaneous cameras in — several
    // transcribe:true files with no voices — but the numbering convention
    // (media.ts's isNumbered) says these are sequential parts of one script,
    // not takes of the same moment. This is the fork user's real 6-file case.
    const segments = [segment(0, 0, 1, "raw/01 - a.mp4")]
    const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]

    const numberedMedia = [
      media({ path: "raw/01 - a.mp4", transcribe: true, voices: null }),
      media({ path: "raw/02 - b.mp4", transcribe: true, voices: null }),
    ]

    expect(() => buildKeptRuns(segments, spans, numberedMedia)).not.toThrow()
  })
})

describe("remapBeatSheetTiming", () => {
  test("an entry after one cut segment is remapped to the shortened cut timeline", () => {
    // Kept: [0, 2), cut: [2, 5), kept: [5, 10) — the entry sits at script
    // time 6, 1s into the second run. On the cut video the first run still
    // takes up 2s, so the entry should land at 2 + 1 = 3.
    const runs: TimelineRun[] = [
      { file: "raw/a.mp4", sourceStart: 0, sourceEnd: 2 },
      { file: "raw/a.mp4", sourceStart: 5, sourceEnd: 10 },
    ]

    const { remapped, errors } = remapBeatSheetTiming(runs, [
      { id: "scene_1", sourceFile: "raw/a.mp4", scriptStart: 6, windowSec: 1 },
    ])

    expect(errors).toEqual([])
    expect(remapped).toEqual([{ id: "scene_1", cutAt: 3 }])
  })

  test("multiple cut segments before the entry all shrink the offset", () => {
    // Three kept runs of 2s each, separated by cuts. The entry starts at the
    // very beginning of the third run (script time 12) — the cut timeline
    // must skip over both preceding cuts, landing at 2 + 2 = 4, not just
    // past the last one.
    const runs: TimelineRun[] = [
      { file: "raw/a.mp4", sourceStart: 0, sourceEnd: 2 },
      { file: "raw/a.mp4", sourceStart: 5, sourceEnd: 7 },
      { file: "raw/a.mp4", sourceStart: 12, sourceEnd: 14 },
    ]

    const { remapped, errors } = remapBeatSheetTiming(runs, [
      { id: "scene_1", sourceFile: "raw/a.mp4", scriptStart: 12, windowSec: 1 },
    ])

    expect(errors).toEqual([])
    expect(remapped).toEqual([{ id: "scene_1", cutAt: 4 }])
  })

  test("an entry whose window overlaps a cut segment is reported, not placed", () => {
    // Kept: [0, 2), cut: [2, 5). The entry starts at 1 (inside the kept run)
    // but its window (1 -> 1 + 2 = 3) runs past sourceEnd (2) into the cut —
    // no single kept stretch covers the whole window.
    const runs: TimelineRun[] = [{ file: "raw/a.mp4", sourceStart: 0, sourceEnd: 2 }]

    const { remapped, errors } = remapBeatSheetTiming(runs, [
      { id: "scene_1", sourceFile: "raw/a.mp4", scriptStart: 1, windowSec: 2 },
    ])

    expect(remapped).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(BeatSheetTimingError)
    expect(errors[0].entryId).toBe("scene_1")
  })

  test("an entry entirely inside cut content is reported, not placed", () => {
    // Kept: [0, 2), cut: [2, 5), kept: [5, 7). scriptStart falls at 3, which
    // no run covers at all.
    const runs: TimelineRun[] = [
      { file: "raw/a.mp4", sourceStart: 0, sourceEnd: 2 },
      { file: "raw/a.mp4", sourceStart: 5, sourceEnd: 7 },
    ]

    const { remapped, errors } = remapBeatSheetTiming(runs, [
      { id: "scene_1", sourceFile: "raw/a.mp4", scriptStart: 3, windowSec: 1 },
    ])

    expect(remapped).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].entryId).toBe("scene_1")
  })

  test("processes every entry independently — one overlap doesn't block the rest", () => {
    const runs: TimelineRun[] = [
      { file: "raw/a.mp4", sourceStart: 0, sourceEnd: 2 },
      { file: "raw/a.mp4", sourceStart: 5, sourceEnd: 10 },
    ]

    const { remapped, errors } = remapBeatSheetTiming(runs, [
      { id: "ok", sourceFile: "raw/a.mp4", scriptStart: 6, windowSec: 1 },
      { id: "overlap", sourceFile: "raw/a.mp4", scriptStart: 1, windowSec: 5 },
    ])

    expect(remapped).toEqual([{ id: "ok", cutAt: 3 }])
    expect(errors).toHaveLength(1)
    expect(errors[0].entryId).toBe("overlap")
  })
})
