import { describe, expect, test } from "bun:test"

import {
  applyEditingPlanDecisions,
  mergeEditingPlan,
  resolvePlanReviewDecisions,
  updatePlanElementLifecycle,
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
      "section_zoom_section-1",
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

  test("keeps a window anchored across a cleaned-up segment gap", () => {
    const automatic = element({
      fromSegment: 0,
      toSegment: 2,
      status: "approved",
    })

    const merged = mergeEditingPlan(
      document({ elements: [automatic] }),
      proposal({ elements: [] }),
      new Set([0, 2])
    )

    expect(merged.elements[0]).toMatchObject({
      id: automatic.id,
      status: automatic.status,
    })
  })

  test("lets a new explicit intention displace an older approved automatic one", () => {
    const approvedAutomatic = element({
      id: "automatic-title",
      status: "approved",
    })
    const command = element({
      id: "command-title",
      source: "command",
      titleText: "Explicit title",
    })

    const merged = mergeEditingPlan(
      document({ elements: [approvedAutomatic] }),
      proposal({ elements: [command] }),
      new Set([0, 1])
    )

    expect(merged.elements).toContainEqual(command)
    expect(merged.elements).toContainEqual(
      element({ id: "automatic-title", status: "conflict" })
    )
  })

  test("allows a zoom and a B-roll scene to share a window", () => {
    const merged = mergeEditingPlan(
      document(),
      proposal({
        elements: [
          element({ id: "zoom", type: "zoom" }),
          element({ id: "scene", type: "scene" }),
        ],
      }),
      new Set([0, 1])
    )

    // The automatic section-start zoom lands on the same anchor and the same
    // type as the proposed zoom, so it's the one flagged as a conflict.
    expect(merged.elements.map((item) => item.status)).toEqual([
      "proposed",
      "conflict",
      "proposed",
    ])
  })

  test("adds an automatic zoom at the start of every section, even when the agent proposed none", () => {
    const merged = mergeEditingPlan(
      document(),
      proposal({ elements: [] }),
      new Set([0, 1])
    )

    expect(merged.elements).toContainEqual({
      id: "section_zoom_section-1",
      sectionId: "section-1",
      type: "zoom",
      source: "automatic",
      status: "proposed",
      fromSegment: 0,
      toSegment: 0,
      reason: "Zoom automatique en début de section",
      zoomPreset: "medium",
    })
  })

  test("carries an approved section-start zoom forward across a rerun", () => {
    const approved = {
      id: "section_zoom_section-1",
      sectionId: "section-1",
      type: "zoom" as const,
      source: "automatic" as const,
      status: "approved" as const,
      fromSegment: 0,
      toSegment: 0,
      reason: "Zoom automatique en début de section",
      zoomPreset: "medium" as const,
    }

    const merged = mergeEditingPlan(
      document({ elements: [approved] }),
      proposal({ elements: [] }),
      new Set([0, 1])
    )

    expect(merged.elements).toContainEqual(approved)
  })

  // Same rule as every other automatic element (see "preserves accepted
  // automatic elements and replaces pending ones" above): only an approved
  // one is protected. A rejected section-start zoom comes back as "proposed"
  // on the next rerun rather than staying rejected.
  test("recreates a rejected section-start zoom as proposed on the next rerun", () => {
    const rejected = {
      id: "section_zoom_section-1",
      sectionId: "section-1",
      type: "zoom" as const,
      source: "automatic" as const,
      status: "rejected" as const,
      fromSegment: 0,
      toSegment: 0,
      reason: "Zoom automatique en début de section",
      zoomPreset: "medium" as const,
    }

    const merged = mergeEditingPlan(
      document({ elements: [rejected] }),
      proposal({ elements: [] }),
      new Set([0, 1])
    )

    expect(merged.elements).toContainEqual({ ...rejected, status: "proposed" })
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

  test("covers analysis, review, rerun, anchors, and explicit priority", () => {
    const explicit = element({
      id: "command-title",
      source: "command",
      fromSegment: 2,
      toSegment: 2,
      titleText: "Explicit title",
    })
    const automatic = element({
      id: "automatic-title",
      fromSegment: 2,
      toSegment: 2,
    })

    const proposed = mergeEditingPlan(
      document({ elements: [] }),
      proposal({ elements: [explicit, automatic] }),
      new Set([0, 2])
    )
    const reviewed = applyEditingPlanDecisions(
      proposed,
      [
        { id: explicit.id, action: "approve" },
        { id: automatic.id, action: "reject" },
      ],
      []
    )
    const rerun = mergeEditingPlan(
      reviewed,
      proposal({
        elements: [element({ id: automatic.id, fromSegment: 2, toSegment: 2 })],
      }),
      new Set([0, 2])
    )

    expect(rerun.elements).toContainEqual(
      expect.objectContaining({
        id: explicit.id,
        source: "command",
        status: "approved",
        fromSegment: 2,
        toSegment: 2,
      })
    )
    expect(rerun.elements).toContainEqual(
      expect.objectContaining({ id: automatic.id, status: "conflict" })
    )
  })
})

describe("scene lifecycle in the editing document", () => {
  test("keeps the plan identity and renderer outputs through each transition", () => {
    const current = document({
      elements: [
        element({
          id: "scene-plan-1",
          type: "scene",
          status: "approved",
          sceneType: "concept",
        }),
      ],
    })

    const generating = updatePlanElementLifecycle(current, "scene-plan-1", {
      sceneId: "scene_01",
      renderStatus: "generating",
    })
    const rendered = updatePlanElementLifecycle(generating, "scene-plan-1", {
      renderStatus: "rendered",
      htmlPath: "scenes/scene_01.html",
      compositionStatus: "not-composed",
    })
    const composed = updatePlanElementLifecycle(rendered, "scene-plan-1", {
      renderStatus: "exported",
      exportPath: "exports/scene_01.mov",
      compositionStatus: "composed",
    })

    expect(composed.elements[0]).toMatchObject({
      id: "scene-plan-1",
      sceneId: "scene_01",
      status: "approved",
      renderStatus: "exported",
      htmlPath: "scenes/scene_01.html",
      exportPath: "exports/scene_01.mov",
      compositionStatus: "composed",
    })
  })

  test("retains an isolated failure and makes it retryable", () => {
    const current = document({
      elements: [element({ id: "scene-plan-1", type: "scene" })],
    })

    const failed = updatePlanElementLifecycle(current, "scene-plan-1", {
      sceneId: "scene_01",
      renderStatus: "failed",
      renderError: "model timed out",
    })
    const retrying = updatePlanElementLifecycle(failed, "scene-plan-1", {
      renderStatus: "generating",
      renderError: undefined,
    })

    expect(failed.elements[0]).toMatchObject({
      renderStatus: "failed",
      renderError: "model timed out",
    })
    expect(retrying.elements[0]).toMatchObject({
      id: "scene-plan-1",
      renderStatus: "generating",
    })
    expect(retrying.elements[0].renderError).toBeUndefined()
  })
})

describe("resolvePlanReviewDecisions", () => {
  test("drops an orphaned element entirely", () => {
    const elements = [element({ id: "a", status: "orphaned" })]

    expect(resolvePlanReviewDecisions(elements, {})).toEqual([])
  })

  test("drops a conflict left undecided, but sends one the reviewer acted on", () => {
    const elements = [
      element({ id: "a", status: "conflict" }),
      element({ id: "b", status: "conflict" }),
    ]

    const result = resolvePlanReviewDecisions(elements, {
      b: { id: "b", action: "reject" },
    })

    expect(result).toEqual([{ id: "b", action: "reject" }])
  })

  test("defaults an untouched, previously-rejected element to reject", () => {
    const elements = [element({ id: "a", status: "rejected" })]

    expect(resolvePlanReviewDecisions(elements, {})).toEqual([
      { id: "a", action: "reject" },
    ])
  })

  test("defaults every other untouched element to approve", () => {
    const elements = [element({ id: "a", status: "proposed" })]

    expect(resolvePlanReviewDecisions(elements, {})).toEqual([
      { id: "a", action: "approve" },
    ])
  })

  test("carries a drafted modify decision through as an approve with its edits", () => {
    const elements = [element({ id: "a", status: "proposed" })]

    const result = resolvePlanReviewDecisions(elements, {
      a: { id: "a", action: "modify", titleText: "New wording" },
    })

    expect(result).toEqual([
      { id: "a", action: "approve", titleText: "New wording" },
    ])
  })
})
