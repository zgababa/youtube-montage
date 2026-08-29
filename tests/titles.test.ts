import { describe, expect, test } from "bun:test"

import {
  createTitlePlanElement,
  decidePlanElement,
} from "../src/mastra/lib/editing-plan"
import { buildSegments } from "../src/mastra/lib/segments"
import {
  TITLE_DURATION_SEC,
  renderTitleHtml,
  titleElementToOverlayScene,
} from "../src/mastra/lib/titles"
import type {
  EditingSection,
  Span,
  StyleGuide,
  Word,
} from "../src/mastra/schemas"

/** `n` words, one per second, each 0.5s long — no pauses unless asked for. */
function words(texts: string[], file = "raw/01.mp4"): Word[] {
  let clock = 0
  return texts.map((w) => {
    const start = clock
    clock += 0.5
    return { w, start, end: clock, file }
  })
}

const noSections: EditingSection[] = []

describe("createTitlePlanElement", () => {
  test("anchors on a kept segment, without touching the transcript text", () => {
    const segments = buildSegments(words(["hello", "world"]))
    const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]

    const element = createTitlePlanElement({
      segments,
      spans,
      sections: noSections,
      fromSegment: 0,
      toSegment: 0,
      titleText: "The agents",
    })

    expect(element.titleText).toBe("The agents")
    expect(element.status).toBe("proposed")
    expect(element.type).toBe("title")
    expect(element.source).toBe("manual")
    expect(element.fromSegment).toBe(0)
    expect(element.toSegment).toBe(0)
    expect(element.id).toBeTruthy()
  })

  test("refuses a target belonging to a cut span, without restoring it", () => {
    const segments = buildSegments(words(["um", "filler", "words"]))
    const spans: Span[] = [
      { start: 0, end: 1.5, action: "cut", category: "filler" },
    ]

    expect(() =>
      createTitlePlanElement({
        segments,
        spans,
        sections: noSections,
        fromSegment: 0,
        toSegment: 0,
        titleText: "Title",
      })
    ).toThrow(/cut span/i)

    // The refusal must not have mutated the span it inspected.
    expect(spans[0].action).toBe("cut")
  })

  test("refuses a segment index that doesn't exist", () => {
    const segments = buildSegments(words(["one", "two"]))
    const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]

    expect(() =>
      createTitlePlanElement({
        segments,
        spans,
        sections: noSections,
        fromSegment: 99,
        toSegment: 99,
        titleText: "x",
      })
    ).toThrow(/segment/i)
  })
})

describe("decidePlanElement", () => {
  const segments = buildSegments(words(["hello", "world"]))
  const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]
  const proposed = createTitlePlanElement({
    segments,
    spans,
    sections: noSections,
    fromSegment: 0,
    toSegment: 0,
    titleText: "Draft title",
  })

  test("modify edits the text and leaves the status alone", () => {
    const decided = decidePlanElement(proposed, {
      action: "modify",
      titleText: "Better title",
    })

    expect(decided.titleText).toBe("Better title")
    expect(decided.status).toBe("proposed")
  })

  test("modifying an already-rendered title drops its render", () => {
    const rendered = {
      ...proposed,
      status: "approved" as const,
      htmlPath: "titles/title_1.html",
      exportPath: "exports/title_1.mov",
    }

    const decided = decidePlanElement(rendered, {
      action: "modify",
      titleText: "New wording",
    })

    // Otherwise `titlesStep` skips it (it only renders `exportPath === null`)
    // and the composited screen keeps showing the old copy.
    expect(decided.htmlPath).toBeNull()
    expect(decided.exportPath).toBeNull()
  })

  test("approve marks it approved", () => {
    const decided = decidePlanElement(proposed, { action: "approve" })
    expect(decided.status).toBe("approved")
    expect(decided.titleText).toBe("Draft title")
  })

  test("reject marks it rejected without touching the text", () => {
    const decided = decidePlanElement(proposed, { action: "reject" })
    expect(decided.status).toBe("rejected")
    expect(decided.titleText).toBe("Draft title")
  })
})

describe("renderTitleHtml", () => {
  const styleGuide: StyleGuide = {
    palette: ["#0a0a0a", "#f5f5f5"],
    fontStack: "Inter, sans-serif",
    motion: "none",
    notes: "",
  }

  test("is a dynamic template carrying the chosen copy, verbatim", () => {
    const html = renderTitleHtml("The agents", styleGuide)

    expect(html).toContain("The agents")
    expect(html).toContain(styleGuide.fontStack)
    expect(html).toContain("transparent")
  })

  test("has CSS animations for entrance — fade-in and slide-up", () => {
    const html = renderTitleHtml("Animated", styleGuide)
    expect(html).toMatch(/@keyframes/)
    expect(html).toMatch(/animation\s*:/)
    expect(html).toContain("cubic-bezier")
  })

  test("escapes the copy so a stray '<' can't break the template", () => {
    const html = renderTitleHtml("<script>x</script>", styleGuide)
    expect(html).not.toContain("<script>x</script>")
  })
})

describe("titleElementToOverlayScene", () => {
  test("projects an exported element to the standard two-second overlay", () => {
    const segments = buildSegments(words(["hello", "world"]))
    const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]
    const element = {
      ...createTitlePlanElement({
        segments,
        spans,
        sections: noSections,
        fromSegment: 0,
        toSegment: 0,
        titleText: "Hi",
      }),
      status: "approved" as const,
      exportPath: "exports/title_1.mov",
    }

    const overlay = titleElementToOverlayScene(element, segments)

    expect(overlay).toEqual({
      id: element.id,
      planElementId: element.id,
      sourceFile: segments[0].file,
      scriptStart: segments[0].start,
      durationSec: TITLE_DURATION_SEC,
      exportPath: "exports/title_1.mov",
    })
  })

  test("refuses to project an element with no export yet", () => {
    const segments = buildSegments(words(["hello", "world"]))
    const spans: Span[] = [{ start: 0, end: 1, action: "keep" }]
    const element = createTitlePlanElement({
      segments,
      spans,
      sections: noSections,
      fromSegment: 0,
      toSegment: 0,
      titleText: "Hi",
    })

    expect(() => titleElementToOverlayScene(element, segments)).toThrow(
      /exportPath/
    )
  })
})

test("the standard title duration is two seconds", () => {
  expect(TITLE_DURATION_SEC).toBe(2)
})
