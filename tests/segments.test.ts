import { describe, expect, test } from "bun:test"

import {
  assertTiles,
  buildSegments,
  cutsToSpans,
  describeCut,
  keptSegments,
  type CutDecision,
} from "../src/mastra/lib/segments"
import type { Word } from "../src/mastra/schemas"

/** `n` words, one per second, each 0.5s long — no pauses unless asked for. */
function words(
  texts: string[],
  { file = "raw/a.mp4", gapAt = new Set<number>() } = {}
): Word[] {
  let clock = 0
  return texts.map((w, i) => {
    if (gapAt.has(i)) clock += 1
    const start = clock
    clock += 0.5
    return { w, start, end: clock, file }
  })
}

describe("buildSegments", () => {
  test("splits on pauses", () => {
    const segments = buildSegments(
      words(["so", "the", "queue", "picks", "it", "up"], {
        gapAt: new Set([3]),
      })
    )

    expect(segments).toHaveLength(2)
    expect(segments[0].text).toBe("so the queue")
    expect(segments[1].text).toBe("picks it up")
  })

  test("never puts one file's words in another file's segment", () => {
    const segments = buildSegments([
      ...words(["one", "two"], { file: "raw/a.mp4" }),
      ...words(["three", "four"], { file: "raw/b.mp4" }),
    ])

    expect(segments.map((s) => s.file)).toEqual(["raw/a.mp4", "raw/b.mp4"])
  })

  test("boundaries land on real word timings", () => {
    const list = words(["a", "b", "c"], { gapAt: new Set([2]) })
    const segments = buildSegments(list)

    for (const segment of segments) {
      expect(list.some((w) => w.start === segment.start)).toBe(true)
      expect(list.some((w) => w.end === segment.end)).toBe(true)
    }
  })
})

describe("cutsToSpans", () => {
  const segments = buildSegments(
    words(["one", "two", "three", "four", "five", "six"], {
      gapAt: new Set([1, 2, 3, 4, 5]),
    })
  )

  test("one segment per index", () => {
    expect(segments).toHaveLength(6)
  })

  test("fills the gaps around a cut with keeps", () => {
    const spans = cutsToSpans(
      [{ from: 2, to: 3, category: "filler", reason: "um" }],
      segments
    )

    expect(spans.map((s) => s.action)).toEqual(["keep", "cut", "keep"])
    assertTiles(spans, segments)
  })

  test("tiles when the cut is at the very start", () => {
    const spans = cutsToSpans(
      [{ from: 0, to: 0, category: "false_start", reason: "restart" }],
      segments
    )

    expect(spans.map((s) => s.action)).toEqual(["cut", "keep"])
    assertTiles(spans, segments)
  })

  test("tiles when the cut is at the very end", () => {
    const spans = cutsToSpans(
      [{ from: 5, to: 5, category: "tangent", reason: "trailed off" }],
      segments
    )

    expect(spans.map((s) => s.action)).toEqual(["keep", "cut"])
    assertTiles(spans, segments)
  })

  test("merges cuts that overlap across window seams", () => {
    // The same filler flagged twice by two overlapping windows.
    const spans = cutsToSpans(
      [
        { from: 1, to: 3, category: "filler", reason: "first pass" },
        { from: 2, to: 4, category: "filler", reason: "second pass" },
      ],
      segments
    )

    const cuts = spans.filter((s) => s.action === "cut")
    expect(cuts).toHaveLength(1)
    expect(cuts[0].start).toBe(segments[1].start)
    // Runs up to where the next kept segment begins, so the silence after the
    // cut goes with it rather than being stranded between spans.
    expect(cuts[0].end).toBe(segments[5].start)
    assertTiles(spans, segments)
  })

  test("drops indices the model invented rather than clamping them", () => {
    const spans = cutsToSpans(
      [{ from: 99, to: 120, category: "filler", reason: "hallucinated" }],
      segments
    )

    // Nothing cut, and the whole transcript still covered.
    expect(spans.every((s) => s.action === "keep")).toBe(true)
    assertTiles(spans, segments)
  })

  test("tiles for every single-segment cut position", () => {
    for (let i = 0; i < segments.length; i++) {
      const spans = cutsToSpans(
        [{ from: i, to: i, category: "filler", reason: "x" }],
        segments
      )
      assertTiles(spans, segments)
    }
  })

  test("cutting everything still covers the transcript", () => {
    const spans = cutsToSpans(
      [{ from: 0, to: 5, category: "bad_take", reason: "all of it" }],
      segments
    )

    expect(spans).toHaveLength(1)
    assertTiles(spans, segments)
  })

  test("no cuts means one keep covering everything", () => {
    const spans = cutsToSpans([], segments)

    expect(spans).toEqual([
      {
        start: segments[0].start,
        end: segments[segments.length - 1].end,
        action: "keep",
      },
    ])
  })

  test("random cut sets always tile", () => {
    for (let trial = 0; trial < 200; trial++) {
      const cuts: CutDecision[] = Array.from(
        { length: 1 + Math.floor(Math.random() * 4) },
        () => {
          const from = Math.floor(Math.random() * segments.length)
          return {
            from,
            to: from + Math.floor(Math.random() * 3),
            category: "filler" as const,
            reason: "fuzz",
          }
        }
      )
      assertTiles(cutsToSpans(cuts, segments), segments)
    }
  })
})

describe("keptSegments", () => {
  const segments = buildSegments(
    words(["one", "two", "three", "four"], { gapAt: new Set([1, 2, 3]) })
  )

  test("drops cut segments and keeps original indices", () => {
    const spans = cutsToSpans(
      [{ from: 1, to: 1, category: "filler", reason: "um" }],
      segments
    )
    const kept = keptSegments(segments, spans)

    expect(kept.map((s) => s.index)).toEqual([0, 2, 3])
    // Indices are what the scenario agent points at, so they must stay
    // anchored to the full transcript rather than being renumbered.
    expect(kept.map((s) => s.text)).toEqual(["one", "three", "four"])
  })

  test("returns everything when nothing is cut", () => {
    expect(keptSegments(segments, cutsToSpans([], segments))).toHaveLength(4)
  })
})

describe("describeCut", () => {
  const segments = buildSegments([
    { w: "um", start: 10, end: 10.3, file: "a.mp4" },
    { w: "so", start: 10.35, end: 10.6, file: "a.mp4" },
    { w: "the", start: 10.65, end: 10.9, file: "a.mp4" },
    { w: "agent", start: 71.0, end: 71.5, file: "a.mp4" },
    { w: "runs", start: 71.55, end: 72.0, file: "a.mp4" },
  ])

  /**
   * The agent works in segment indices, which say nothing to a reader. The log
   * has to show the moment and the words, or a streaming cleanup pass is just
   * a list of numbers going by.
   */
  test("renders a cut as timecode, category and the words it removes", () => {
    const line = describeCut(
      { from: 0, to: 0, category: "filler", reason: "hesitation" },
      segments
    )

    expect(line).toContain("00:10")
    expect(line).toContain("filler")
    expect(line).toContain("um so the")
  })

  test("spans a multi-segment cut from first start to last end", () => {
    const line = describeCut({ from: 0, to: 1, category: "tangent" }, segments)

    expect(line).toContain("00:10")
    expect(line).toContain("01:12")
  })

  test("numbers the line when given a position", () => {
    expect(describeCut({ from: 0 }, segments, 7)).toMatch(/^\s*7\. /)
  })

  /** Called mid-stream, so most fields are routinely still missing. */
  test("survives a half-arrived decision", () => {
    const line = describeCut({ from: 0 }, segments)

    expect(line).toContain("um so the")
    // No category yet — shown as unknown rather than crashing or guessing.
    expect(line).toContain("?")
  })

  test("nothing to render before an index has arrived", () => {
    expect(describeCut({}, segments)).toBeNull()
    expect(describeCut({ category: "filler" }, segments)).toBeNull()
  })

  test("an index outside the window renders nothing", () => {
    // A hallucinated index must not be reported as a real decision.
    expect(describeCut({ from: 99, to: 99 }, segments)).toBeNull()
  })

  test("long text is truncated to one line", () => {
    const long = buildSegments(
      Array.from({ length: 30 }, (_, i) => ({
        w: `word${i}`,
        start: 1 + i * 0.2,
        end: 1.15 + i * 0.2,
        file: "a.mp4",
      }))
    )
    const line = describeCut({ from: 0, category: "filler" }, long)!

    expect(line).toContain("…")
    expect(line.length).toBeLessThan(120)
  })
})
