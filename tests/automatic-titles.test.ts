import { describe, expect, test } from "bun:test"

import { buildCompositeOverlays } from "../src/mastra/lib/composite"
import {
  applyEditingPlanDecisions,
  type EditingPlanDecision,
} from "../src/mastra/lib/editing-plan"
import {
  buildFcpxml,
  buildTimelineLayout,
  type TimelineTitleInsertion,
} from "../src/mastra/lib/fcpxml"
import { shortTitleText } from "../src/mastra/lib/titles"
import type { MediaFile, StoredProject } from "../src/mastra/schemas"
import type { TimelineRun } from "../src/mastra/lib/timeline"

const media: MediaFile = {
  path: "raw/01 - talk.mp4",
  durationSec: 120,
  hasAudio: true,
  hasVideo: true,
  transcribe: true,
  offsetSec: 0,
  voices: null,
}

function project(overrides: Partial<StoredProject> = {}): StoredProject {
  return {
    version: 1,
    id: "project_1",
    path: "/projects/demo",
    name: "Demo",
    createdAt: "2026-08-21T00:00:00.000Z",
    fps: 30,
    media: [media],
    transcriptionHints: { prompt: "", keyterms: [] },
    transcript: {
      words: [
        { w: "Opening", start: 0, end: 1, file: media.path },
        { w: "section", start: 4, end: 5, file: media.path },
        { w: "closing", start: 8, end: 9, file: media.path },
      ],
    },
    spans: [
      { start: 0, end: 1, action: "keep" },
      { start: 4, end: 5, action: "keep" },
      { start: 8, end: 9, action: "keep" },
    ],
    cleanupApprovedAt: "2026-08-21T00:00:00.000Z",
    maxSilenceSec: 0.3,
    timelineApprovedAt: "2026-08-21T00:00:00.000Z",
    compositeApprovedAt: null,
    styleGuide: { palette: [], fontStack: "", motion: "", notes: "" },
    scenes: [],
    editingDocument: {
      sections: [
        {
          id: "section_01",
          fromSegment: 0,
          toSegment: 2,
          name: "Opening",
          reason: "Major section",
          source: "automatic",
        },
      ],
      elements: [],
      analysisAt: "2026-08-21T00:00:00.000Z",
      reviewedAt: "2026-08-21T00:00:00.000Z",
    },
    titleAnnotations: [],
    copy: null,
    ...overrides,
  }
}

function insertion(
  overrides: Partial<TimelineTitleInsertion> = {}
): TimelineTitleInsertion {
  return {
    id: "automatic_title_01",
    sourceFile: media.path,
    scriptStart: 4,
    durationSec: 2,
    exportPath: "exports/automatic_title_01.mov",
    ...overrides,
  }
}

describe("automatic title timeline insertion", () => {
  const runs: TimelineRun[] = [
    { file: media.path, sourceStart: 0, sourceEnd: 10 },
  ]

  test("inserts two seconds before the anchor without shortening the source", () => {
    const layout = buildTimelineLayout(runs, [insertion()], 30)

    expect(layout.sourceDurationSec).toBe(10)
    expect(layout.timelineDurationSec).toBe(12)
    expect(layout.items.map((item) => item.kind)).toEqual([
      "source",
      "title",
      "source",
    ])
    expect(layout.items[0]).toMatchObject({
      kind: "source",
      run: { sourceStart: 0, sourceEnd: 4 },
    })
    expect(layout.items[1]).toMatchObject({
      kind: "title",
      title: { id: "automatic_title_01", timelineOffsetSec: 4 },
    })
    expect(layout.items[2]).toMatchObject({
      kind: "source",
      run: { sourceStart: 4, sourceEnd: 10 },
    })
  })

  test("recalibrates later title offsets after every accepted insertion", () => {
    const layout = buildTimelineLayout(
      runs,
      [
        insertion({ id: "automatic_title_01", scriptStart: 2 }),
        insertion({ id: "automatic_title_02", scriptStart: 7 }),
      ],
      30
    )

    expect(layout.titlePlacements).toMatchObject([
      { id: "automatic_title_01", timelineOffsetSec: 2 },
      { id: "automatic_title_02", timelineOffsetSec: 9 },
    ])
    expect(layout.timelineDurationSec).toBe(14)
  })

  test("writes inserted titles as primary clips and preserves the speech clips", () => {
    const xml = buildFcpxml(project(), runs, [], null, [insertion()])
    const clips = [...xml.matchAll(/<asset-clip\b[^>]*>/g)].map(
      (match) => match[0]
    )

    expect(clips).toHaveLength(3)
    expect(xml).toContain('ref="title-asset-automatic_title_01"')
    expect(xml).toContain('name="automatic_title_01"')
    expect(xml).toContain('duration="2/1s"')
    expect(xml).toContain('start="4/1s" duration="6/1s"')
    expect(xml).toContain('<sequence format="format-1" duration="12/1s"')
    expect(xml).not.toContain('lane="')
  })
})

describe("automatic title plan references", () => {
  test("exposes approved rendered plan titles as insertions", () => {
    const current = project({
      editingDocument: {
        ...project().editingDocument,
        elements: [
          {
            id: "automatic_title_01",
            sectionId: "section_01",
            type: "title",
            source: "automatic",
            status: "approved",
            fromSegment: 1,
            toSegment: 1,
            reason: "Major section",
            titleText: "The section",
            htmlPath: "titles/automatic_title_01.html",
            exportPath: "exports/automatic_title_01.mov",
          },
        ],
      },
    })

    const { titleInsertions } = buildCompositeOverlays(current)

    expect(titleInsertions).toEqual([
      {
        id: "automatic_title_01",
        sourceFile: media.path,
        scriptStart: 4,
        durationSec: 2,
        exportPath: "exports/automatic_title_01.mov",
      },
    ])
  })

  test("clears a composed render when the creator changes or rejects its copy", () => {
    const current = project({
      editingDocument: {
        ...project().editingDocument,
        elements: [
          {
            id: "automatic_title_01",
            sectionId: "section_01",
            type: "title",
            source: "automatic",
            status: "approved",
            fromSegment: 1,
            toSegment: 1,
            reason: "Major section",
            titleText: "The section",
            htmlPath: "titles/automatic_title_01.html",
            exportPath: "exports/automatic_title_01.mov",
            composed: true,
            timelineOffsetSec: 4,
            timelineDurationSec: 2,
          },
        ],
      },
    })

    const modified = applyEditingPlanDecisions(
      current.editingDocument,
      [
        {
          id: "automatic_title_01",
          action: "modify",
          titleText: "A different section",
        },
      ] satisfies EditingPlanDecision[],
      []
    )
    expect(modified.elements[0]).toMatchObject({
      titleText: "A different section",
      htmlPath: null,
      exportPath: null,
      composed: false,
      timelineOffsetSec: null,
    })

    const rejected = applyEditingPlanDecisions(
      current.editingDocument,
      [{ id: "automatic_title_01", action: "reject" }],
      []
    )
    expect(rejected.elements[0]).toMatchObject({
      status: "rejected",
      htmlPath: null,
      exportPath: null,
      composed: false,
    })
  })

  test("keeps automatic labels short while preserving their editable wording", () => {
    const label = shortTitleText(
      "A very long section label that should remain readable in the title card without taking over the frame"
    )

    expect(label.length).toBeLessThanOrEqual(80)
    expect(label).toContain("A very long section label")
  })
})
