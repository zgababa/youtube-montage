import { describe, expect, test } from "bun:test"

import {
  applyEditingPlanDecisions,
  mergeEditingPlan,
  parseTitleCommands,
  type EditingPlanDecision,
  type EditingSectionDecision,
  type EditingPlanProposal,
} from "../src/mastra/lib/editing-plan"
import type { EditingDocument } from "../src/mastra/schemas"

function element(
  over: Partial<EditingDocument["elements"][number]> = {}
): EditingDocument["elements"][number] {
  return {
    id: "element-1",
    sectionId: "section-1",
    type: "title",
    source: "automatic",
    status: "proposed",
    fromSegment: 0,
    toSegment: 0,
    reason: "a reason",
    titleText: "A title",
    ...over,
  }
}

function section(
  over: Partial<EditingDocument["sections"][number]> = {}
): EditingDocument["sections"][number] {
  return {
    id: "section-1",
    fromSegment: 0,
    toSegment: 1,
    name: "Opening",
    reason: "opens the subject",
    source: "automatic",
    ...over,
  }
}

function document(over: Partial<EditingDocument> = {}): EditingDocument {
  return {
    sections: [section()],
    elements: [],
    analysisAt: null,
    reviewedAt: null,
    ...over,
  }
}

function proposal(
  over: Partial<EditingPlanProposal> = {}
): EditingPlanProposal {
  return {
    sections: [section()],
    elements: [element()],
    ...over,
  }
}

describe("mergeEditingPlan", () => {
  test("manual intentions win over an automatic proposal at the same anchor", () => {
    const manual = element({
      id: "manual-title",
      source: "manual",
      status: "approved",
      titleText: "Creator's title",
    })

    const merged = mergeEditingPlan(
      document({ elements: [manual] }),
      proposal({ elements: [element({ id: "automatic-title" })] }),
      new Set([0, 1])
    )

    expect(merged.elements).toContainEqual(manual)
    expect(merged.elements).toContainEqual(
      element({ id: "automatic-title", status: "conflict" })
    )
  })

  test("preserves accepted automatic elements and replaces pending ones", () => {
    const accepted = element({
      id: "accepted",
      status: "approved",
      titleText: "Keep this",
    })
    const stale = element({ id: "stale", titleText: "Recalculate this" })

    const merged = mergeEditingPlan(
      document({ elements: [accepted, stale] }),
      proposal({
        elements: [
          element({ id: "accepted", titleText: "Model changed its mind" }),
          element({ id: "fresh", fromSegment: 1, toSegment: 1 }),
        ],
      }),
      new Set([0, 1])
    )

    expect(merged.elements).toContainEqual(accepted)
    expect(merged.elements.map((item) => item.id)).toEqual([
      "accepted",
      "fresh",
    ])
    expect(merged.elements).not.toContainEqual(stale)
  })

  test("keeps an explicit intention as an orphan when its segment disappears", () => {
    const manual = element({
      id: "manual-title",
      source: "manual",
      status: "approved",
      fromSegment: 4,
      toSegment: 4,
    })

    const merged = mergeEditingPlan(
      document({ elements: [manual] }),
      proposal({ elements: [] }),
      new Set([0, 1])
    )

    expect(merged.elements).toContainEqual(
      element({
        id: "manual-title",
        source: "manual",
        status: "orphaned",
        fromSegment: 4,
        toSegment: 4,
      })
    )
  })
})

describe("parseTitleCommands", () => {
  test("requires matching markers around a non-empty body", () => {
    expect(
      parseTitleCommands([
        { index: 2, text: "ordinary title mention" },
        { index: 3, text: "TITRE The agents TITRE" },
        { index: 4, text: "TITRE TITRE" },
      ])
    ).toEqual([{ segmentIndex: 3, text: "The agents" }])
  })

  test("finds more than one explicit command in the approved script", () => {
    expect(
      parseTitleCommands([
        {
          index: 1,
          text: "TITRE First idea TITRE then TITRE Second idea TITRE",
        },
      ])
    ).toEqual([
      { segmentIndex: 1, text: "First idea" },
      { segmentIndex: 1, text: "Second idea" },
    ])
  })
})

describe("applyEditingPlanDecisions", () => {
  test("accepts, edits, and rejects elements without changing their identity", () => {
    const current = document({
      elements: [
        element({ id: "title", titleText: "Old copy" }),
        element({ id: "zoom", type: "zoom", zoomPreset: "subtle" }),
      ],
    })
    const decisions: EditingPlanDecision[] = [
      { id: "title", action: "approve", titleText: "Approved copy" },
      { id: "zoom", action: "reject" },
    ]

    const reviewed = applyEditingPlanDecisions(current, decisions, [])

    expect(reviewed.elements).toContainEqual(
      element({
        id: "title",
        status: "approved",
        titleText: "Approved copy",
      })
    )
    expect(reviewed.elements).toContainEqual(
      element({
        id: "zoom",
        type: "zoom",
        status: "rejected",
        zoomPreset: "subtle",
      })
    )
  })

  test("splits and merges sections while keeping elements attached", () => {
    const current = document({
      sections: [
        section({ id: "first", toSegment: 3 }),
        section({ id: "second", fromSegment: 4, toSegment: 6 }),
      ],
      elements: [
        element({ id: "first-element", sectionId: "first", fromSegment: 1 }),
        element({ id: "second-element", sectionId: "second", fromSegment: 5 }),
      ],
    })

    const split: EditingSectionDecision = {
      id: "first",
      action: "split",
      splitAtSegment: 1,
      name: "Introduction",
    }
    const splitResult = applyEditingPlanDecisions(current, [], [split])

    expect(splitResult.sections.map((item) => item.id)).toEqual([
      "first",
      "first-split",
      "second",
    ])
    expect(
      splitResult.elements.find((item) => item.id === "first-element")
        ?.sectionId
    ).toBe("first-split")

    const merge: EditingSectionDecision = {
      id: "first",
      action: "merge",
      mergeWithId: "second",
      name: "Whole opening",
    }
    const merged = applyEditingPlanDecisions(current, [], [merge])

    expect(merged.sections.map((item) => item.id)).toEqual(["first"])
    expect(merged.sections[0].name).toBe("Whole opening")
    expect(
      merged.elements.find((item) => item.id === "second-element")?.sectionId
    ).toBe("first")
  })
})
