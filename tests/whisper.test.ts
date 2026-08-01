import { describe, expect, test } from "bun:test"

import { SEGMENT_SECONDS } from "../src/mastra/lib/ffmpeg"
import { offsetWords } from "../src/mastra/lib/whisper"
import type { Word } from "../src/mastra/schemas"

/**
 * The chunk offset is the quietest way this pipeline can go wrong.
 *
 * Audio over the upload cap is split into fixed pieces, and each piece comes
 * back from Whisper with its clock restarted at zero. If the offset is dropped
 * or misapplied the transcript still reads perfectly — every word is right, in
 * the right order — while every timestamp after the first chunk is wrong by a
 * multiple of ten minutes. Nothing downstream can detect that: the spans tile,
 * the scenes have windows, the shot list looks plausible, and the b-roll lands
 * in the wrong place.
 */
describe("offsetWords", () => {
  const chunk: Word[] = [
    { w: "so", start: 0, end: 0.4, file: "chunk" },
    { w: "then", start: 12.25, end: 12.6, file: "chunk" },
  ]

  test("shifts both ends by the offset", () => {
    const shifted = offsetWords(chunk, SEGMENT_SECONDS, "raw/a-cam-01.mp4")

    expect(shifted[0].start).toBe(600)
    expect(shifted[0].end).toBeCloseTo(600.4, 5)
    expect(shifted[1].start).toBeCloseTo(612.25, 5)
    expect(shifted[1].end).toBeCloseTo(612.6, 5)
  })

  test("re-tags words with the source file, not the chunk", () => {
    const shifted = offsetWords(chunk, SEGMENT_SECONDS, "raw/a-cam-01.mp4")

    // Spans point back at real footage through this field. A word still
    // labelled with its temp chunk can't be located in any source file.
    expect(shifted.every((w) => w.file === "raw/a-cam-01.mp4")).toBe(true)
  })

  test("the first chunk is unshifted", () => {
    expect(offsetWords(chunk, 0, "raw/a.mp4")[1].start).toBeCloseTo(12.25, 5)
  })

  test("chunk boundaries stay contiguous across the seam", () => {
    // A word at the very end of chunk n and one at the start of chunk n+1
    // must not overlap or leave a hole.
    const endOfFirst = offsetWords(
      [{ w: "last", start: 599.8, end: 600, file: "chunk" }],
      0,
      "raw/a.mp4"
    )
    const startOfSecond = offsetWords(
      [{ w: "next", start: 0, end: 0.3, file: "chunk" }],
      SEGMENT_SECONDS,
      "raw/a.mp4"
    )

    expect(startOfSecond[0].start).toBe(endOfFirst[0].end)
  })

  test("offsets accumulate correctly over many chunks", () => {
    for (let index = 0; index < 12; index++) {
      const shifted = offsetWords(
        [{ w: "x", start: 1.5, end: 2, file: "chunk" }],
        index * SEGMENT_SECONDS,
        "raw/a.mp4"
      )
      expect(shifted[0].start).toBeCloseTo(index * 600 + 1.5, 5)
    }
  })
})
