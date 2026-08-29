import { describe, expect, test } from "bun:test"

import { buildSegments } from "../src/mastra/lib/segments"
import { checkTranscriptionHints, toWords } from "../src/mastra/lib/stt"

/**
 * AssemblyAI reports word timings in milliseconds; everything downstream — span
 * boundaries, scene windows, chapter timecodes, the shot list — is in seconds.
 * The conversion happens once, in `toWords`, and nothing below it re-checks the
 * unit. So a dropped factor of 1000 produces a transcript that reads perfectly
 * and cuts in absurd places, with no error anywhere. Hence these tests.
 */

/** Shaped like the provider's `words[]`: text, and ms integers. */
function apiWords(pairs: [string, number, number][]) {
  return pairs.map(([text, start, end]) => ({ text, start, end }))
}

describe("toWords", () => {
  test("converts milliseconds to seconds", () => {
    const words = toWords(
      apiWords([
        ["so", 1520, 1760],
        ["the", 1760, 1880],
        ["agent", 1880, 2340],
      ]),
      "raw/a-cam-01.mp4"
    )

    expect(words).toEqual([
      { w: "so", start: 1.52, end: 1.76, file: "raw/a-cam-01.mp4" },
      { w: "the", start: 1.76, end: 1.88, file: "raw/a-cam-01.mp4" },
      { w: "agent", start: 1.88, end: 2.34, file: "raw/a-cam-01.mp4" },
    ])
  })

  test("tags every word with its source file", () => {
    const words = toWords(apiWords([["hello", 0, 400]]), "raw/b-cam-02.mov")

    // Spans point back at real footage through this field. A word that loses it
    // can still be cut, but the editor can't be told which clip to cut it from.
    expect(words.every((word) => word.file === "raw/b-cam-02.mov")).toBe(true)
  })

  test("handles a word at time zero without dropping it", () => {
    expect(toWords(apiWords([["right", 0, 240]]), "a.mp4")[0].start).toBe(0)
  })

  test("returns nothing for silence", () => {
    expect(toWords([], "a.mp4")).toEqual([])
  })
})

describe("unit conversion, as segmentation sees it", () => {
  /**
   * The real regression guard. `buildSegments` splits on a 0.6s pause and caps
   * segments at 12s — thresholds that are only meaningful in seconds. Left in
   * milliseconds, every gap looks like hundreds of seconds and the transcript
   * shatters into one segment per word, which is what the cleanup agent would
   * then be asked to reason about.
   */
  test("normal speech groups into few segments, not one per word", () => {
    // Twelve words, ~200ms apart: one continuous phrase.
    const raw = apiWords(
      Array.from({ length: 12 }, (_, i): [string, number, number] => [
        `w${i}`,
        1000 + i * 300,
        1000 + i * 300 + 200,
      ])
    )

    const segments = buildSegments(toWords(raw, "a.mp4"))

    expect(segments.length).toBe(1)
    expect(segments[0].text.split(" ")).toHaveLength(12)
  })

  test("a real pause still splits", () => {
    const raw = apiWords([
      ["one", 1000, 1200],
      ["two", 1300, 1500],
      // 2s of silence — comfortably past PAUSE_SEC once converted.
      ["three", 3500, 3700],
    ])

    const segments = buildSegments(toWords(raw, "a.mp4"))

    expect(segments).toHaveLength(2)
    expect(segments[0].text).toBe("one two")
    expect(segments[1].text).toBe("three")
  })

  test("segment boundaries land on real word times, in seconds", () => {
    const segments = buildSegments(
      toWords(
        apiWords([
          ["a", 4200, 4500],
          ["b", 4600, 5100],
        ]),
        "a.mp4"
      )
    )

    expect(segments[0].start).toBe(4.2)
    expect(segments[0].end).toBe(5.1)
  })
})

describe("checkTranscriptionHints", () => {
  test("accepts short keyterms under the total budget", () => {
    const problem = checkTranscriptionHints({
      prompt: "",
      keyterms: ["Mastra", "AssemblyAI"],
    })

    expect(problem).toBeNull()
  })

  test("rejects a keyterm that reads like a sentence", () => {
    const problem = checkTranscriptionHints({
      prompt: "",
      keyterms: ["the agent picks up the job from the queue"],
    })

    expect(problem).toMatch("longer than")
  })

  test("rejects a keyterm list over the total word budget", () => {
    const keyterms = Array.from(
      { length: 250 },
      (_, i) => `term ${i} four five six`
    )

    const problem = checkTranscriptionHints({ prompt: "", keyterms })

    expect(problem).toMatch("over the")
  })
})
