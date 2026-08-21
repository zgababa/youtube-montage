import { describe, expect, test } from "bun:test"

import { buildSegments } from "../src/mastra/lib/segments"
import {
  TITLE_DURATION_SEC,
  createTitleAnnotation,
  decideTitleAnnotation,
  renderTitleHtml,
  titleToOverlayScene,
} from "../src/mastra/lib/titles"
import type { Span, StyleGuide, Word } from "../src/mastra/schemas"

/** `n` words, one per second, each 0.5s long — no pauses unless asked for. */
function words(texts: string[], file = "raw/01.mp4"): Word[] {
  let clock = 0
  return texts.map((w) => {
    const start = clock
    clock += 0.5
    return { w, start, end: clock, file }
  })
}

describe("createTitleAnnotation", () => {
  test("anchors on a kept segment, without touching the transcript text", () => {
    const segments = buildSegments(words(["hello", "world"]))
    const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]

    const annotation = createTitleAnnotation({
      segments,
      spans,
      segmentIndex: 0,
      text: "The agents",
    })

    expect(annotation.text).toBe("The agents")
    expect(annotation.status).toBe("pending")
    expect(annotation.segmentIndex).toBe(0)
    expect(annotation.scriptStart).toBe(segments[0].start)
    expect(annotation.scriptEnd).toBe(segments[0].end)
    expect(annotation.sourceFile).toBe("raw/01.mp4")
    expect(annotation.htmlPath).toBeNull()
    expect(annotation.exportPath).toBeNull()
    expect(annotation.id).toBeTruthy()
  })

  test("refuses a target belonging to a cut span, without restoring it", () => {
    const segments = buildSegments(words(["um", "filler", "words"]))
    const spans: Span[] = [{ start: 0, end: 1.5, action: "cut", category: "filler" }]

    expect(() =>
      createTitleAnnotation({
        segments,
        spans,
        segmentIndex: 0,
        text: "Title",
      })
    ).toThrow(/cut span/i)

    // The refusal must not have mutated the span it inspected.
    expect(spans[0].action).toBe("cut")
  })

  test("refuses a segment index that doesn't exist", () => {
    const segments = buildSegments(words(["one", "two"]))
    const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]

    expect(() =>
      createTitleAnnotation({ segments, spans, segmentIndex: 99, text: "x" })
    ).toThrow(/segment/i)
  })
})

describe("decideTitleAnnotation", () => {
  const segments = buildSegments(words(["hello", "world"]))
  const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]
  const pending = createTitleAnnotation({
    segments,
    spans,
    segmentIndex: 0,
    text: "Draft title",
  })

  test("modify edits the text and leaves the status alone", () => {
    const decided = decideTitleAnnotation(pending, {
      action: "modify",
      text: "Better title",
    })

    expect(decided.text).toBe("Better title")
    expect(decided.status).toBe("pending")
  })

  test("approve marks it approved", () => {
    const decided = decideTitleAnnotation(pending, { action: "approve" })
    expect(decided.status).toBe("approved")
    expect(decided.text).toBe("Draft title")
  })

  test("approve can carry a last-minute edit", () => {
    const decided = decideTitleAnnotation(pending, {
      action: "approve",
      text: "Final title",
    })
    expect(decided.status).toBe("approved")
    expect(decided.text).toBe("Final title")
  })

  test("reject marks it rejected without touching the text", () => {
    const decided = decideTitleAnnotation(pending, { action: "reject" })
    expect(decided.status).toBe("rejected")
    expect(decided.text).toBe("Draft title")
  })
})

describe("renderTitleHtml", () => {
  const styleGuide: StyleGuide = {
    palette: ["#0a0a0a", "#f5f5f5"],
    fontStack: "Inter, sans-serif",
    motion: "none",
    notes: "",
  }

  test("is a static template carrying the chosen copy, verbatim", () => {
    const html = renderTitleHtml("The agents", styleGuide)

    expect(html).toContain("The agents")
    expect(html).toContain(styleGuide.fontStack)
    expect(html).toContain(styleGuide.palette[0])
  })

  test("has no animation — a title screen holds, it doesn't move", () => {
    const html = renderTitleHtml("Static", styleGuide)
    expect(html).not.toMatch(/@keyframes|animation\s*:/i)
  })

  test("escapes the copy so a stray '<' can't break the template", () => {
    const html = renderTitleHtml("<script>x</script>", styleGuide)
    expect(html).not.toContain("<script>x</script>")
  })
})

describe("titleToOverlayScene", () => {
  test("projects an exported annotation to the standard two-second overlay", () => {
    const segments = buildSegments(words(["hello", "world"]))
    const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]
    const annotation = {
      ...createTitleAnnotation({ segments, spans, segmentIndex: 0, text: "Hi" }),
      status: "approved" as const,
      exportPath: "exports/title_1.mov",
    }

    const overlay = titleToOverlayScene(annotation)

    expect(overlay).toEqual({
      id: annotation.id,
      sourceFile: annotation.sourceFile,
      scriptStart: annotation.scriptStart,
      durationSec: TITLE_DURATION_SEC,
      exportPath: "exports/title_1.mov",
    })
  })

  test("refuses to project an annotation with no export yet", () => {
    const segments = buildSegments(words(["hello", "world"]))
    const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]
    const annotation = createTitleAnnotation({
      segments,
      spans,
      segmentIndex: 0,
      text: "Hi",
    })

    expect(() => titleToOverlayScene(annotation)).toThrow(/exportPath/)
  })
})

test("the standard title duration is two seconds", () => {
  expect(TITLE_DURATION_SEC).toBe(2)
})
