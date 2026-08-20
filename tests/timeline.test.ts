import { describe, expect, test } from "bun:test"

import { buildKeptRuns } from "../src/mastra/lib/timeline"
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
