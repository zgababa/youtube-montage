import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  buildDocumentSections,
  buildEditingDocument,
  type DocumentBlock,
} from "../lib/project"
import {
  blankProject,
  createProject,
  hydrate,
  readStoredProject,
  updateProject,
} from "../src/mastra/lib/project"
import { StoredProjectSchema } from "../src/mastra/schemas"
import type { StoredScene } from "../lib/types"

/**
 * End-to-end: a real project folder on disk, written and read back through
 * the same `project.json` serialization every workflow step uses, then
 * rendered through `buildEditingDocument` — the function the UI card calls.
 * This is the seam the issue's "read, write, and display" criterion asks for;
 * there is no browser in this repo to drive a screen instead.
 */

const dirs: string[] = []

async function fixtureDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "editing-doc-test-"))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  )
})

function blockText(block: DocumentBlock): string {
  if (block.kind !== "text") throw new Error(`Expected a text block, got ${block.kind}`)
  return block.segments.map((segment) => segment.text).join(" ")
}

function scene(id: string, scriptStart: number): StoredScene {
  return {
    id,
    scriptStart,
    scriptEnd: scriptStart + 8,
    windowSec: 8,
    coversLine: `line for ${id}`,
    sourceFile: "01.MP4",
    intent: `illustrate ${id}`,
    type: "concept",
    status: "approved",
    htmlPath: `scenes/${id}.html`,
    exportPath: null,
    measuredDurationSec: 6,
  }
}

function media() {
  return {
    path: "01.MP4",
    durationSec: 30,
    hasAudio: true,
    hasVideo: true,
    transcribe: true,
    offsetSec: 0,
    voices: null,
  }
}

describe("buildEditingDocument, read and written through project.json", () => {
  test("shows the approved script and the known elements, referenced not duplicated", async () => {
    const dir = await fixtureDir()
    await createProject(dir, blankProject(dir))

    await updateProject(dir, (current) => ({
      ...current,
      transcript: {
        words: [
          { w: "Hello", start: 0, end: 1, file: "01.MP4" },
          { w: "world", start: 1, end: 2, file: "01.MP4" },
          { w: "um", start: 2, end: 3, file: "01.MP4" },
          { w: "today", start: 10, end: 11, file: "01.MP4" },
        ],
      },
      spans: [
        { start: 0, end: 2, action: "keep" },
        { start: 2, end: 3, action: "cut", category: "filler" },
        { start: 10, end: 11, action: "keep" },
      ],
      cleanupApprovedAt: new Date().toISOString(),
      scenes: [scene("scene_02", 10), scene("scene_01", 0)],
    }))

    const stored = await readStoredProject(dir)
    const project = await hydrate(dir, stored)

    const document = buildEditingDocument(project)

    // The script is the kept spans only — "um" never appears.
    expect(document.script?.text).toBe("Hello world today")
    expect(document.script?.text).not.toContain("um")
    expect(document.script?.keptSpanCount).toBe(2)

    // Known elements reference the scenes, ordered by where they land in the
    // script, without carrying their HTML along.
    expect(document.entries.map((entry) => entry.sceneId)).toEqual([
      "scene_01",
      "scene_02",
    ])
    expect(document.entries[0]).toMatchObject({
      sceneId: "scene_01",
      reason: "illustrate scene_01",
      status: "approved",
      htmlPath: "scenes/scene_01.html",
    })
    expect(document.entries[0]).not.toHaveProperty("html")
  })

  test("links a TITRE annotation to its produced asset and its FCPXML composition", async () => {
    const dir = await fixtureDir()
    await createProject(dir, blankProject(dir))

    await updateProject(dir, (current) => ({
      ...current,
      transcript: {
        words: [
          { w: "Hello", start: 0, end: 1, file: "01.MP4" },
          { w: "world", start: 1, end: 2, file: "01.MP4" },
        ],
      },
      spans: [{ start: 0, end: 2, action: "keep" }],
      cleanupApprovedAt: new Date().toISOString(),
      editingDocument: {
        sections: [],
        elements: [
          {
            id: "title_1",
            sectionId: "",
            type: "title",
            source: "manual",
            status: "approved",
            fromSegment: 0,
            toSegment: 0,
            reason: "Added manually",
            titleText: "The agents",
            htmlPath: "titles/title_1.html",
            exportPath: "exports/title_1.mov",
          },
          {
            id: "title_2",
            sectionId: "",
            type: "title",
            source: "manual",
            status: "proposed",
            fromSegment: 0,
            toSegment: 0,
            reason: "Added manually",
            titleText: "Still pending",
            htmlPath: null,
            exportPath: null,
          },
        ],
        analysisAt: null,
        reviewedAt: null,
      },
    }))

    const stored = await readStoredProject(dir)
    const project = await hydrate(dir, stored)

    const document = buildEditingDocument(project)

    expect(document.titles).toHaveLength(2)

    // `composed` reflects the last actual build of timeline.fcpxml — nothing
    // has rebuilt it here, so it stays false even though this title, once
    // rendered and approved, would be picked up the next time it does
    // (`wouldCompose`). ADR 0006's `Composé` is the persisted fact, not a
    // prediction.
    const rendered = document.titles.find((t) => t.elementId === "title_1")
    expect(rendered).toMatchObject({
      elementId: "title_1",
      text: "The agents",
      status: "approved",
      htmlPath: "titles/title_1.html",
      exportPath: "exports/title_1.mov",
      composed: false,
      wouldCompose: true,
    })

    const pending = document.titles.find((t) => t.elementId === "title_2")
    expect(pending).toMatchObject({
      elementId: "title_2",
      status: "proposed",
      exportPath: null,
      composed: false,
      wouldCompose: false,
    })
  })

  test("shows a planned B-roll scene as composed only when placement reaches FCPXML", async () => {
    const dir = await fixtureDir()
    await createProject(dir, blankProject(dir, [media()]))

    await updateProject(dir, (current) => ({
      ...current,
      transcript: {
        words: [
          { w: "Hello", start: 0, end: 1, file: "01.MP4" },
          { w: "world", start: 1, end: 2, file: "01.MP4" },
        ],
      },
      spans: [{ start: 0, end: 2, action: "keep" }],
      cleanupApprovedAt: new Date().toISOString(),
      editingDocument: {
        sections: [
          {
            id: "section-1",
            fromSegment: 0,
            toSegment: 0,
            name: "Opening",
            reason: "starts the subject",
            source: "automatic",
          },
        ],
        elements: [
          {
            id: "scene-plan-1",
            sectionId: "section-1",
            type: "scene",
            source: "automatic",
            status: "approved",
            fromSegment: 0,
            toSegment: 0,
            reason: "illustrate the opening",
            sceneId: "scene_01",
            renderStatus: "exported",
            htmlPath: "scenes/scene_01.html",
            exportPath: "exports/scene_01.mov",
            compositionStatus: "composed",
          },
        ],
        analysisAt: new Date().toISOString(),
        reviewedAt: new Date().toISOString(),
      },
      scenes: [
        {
          ...scene("scene_01", 0),
          planElementId: "scene-plan-1",
          sourceFile: "01.MP4",
          status: "exported",
          htmlPath: "scenes/scene_01.html",
          exportPath: "exports/scene_01.mov",
        },
      ],
    }))

    const document = buildEditingDocument(
      await hydrate(dir, await readStoredProject(dir))
    )
    expect(document.entries[0]).toMatchObject({
      sceneId: "scene_01",
      planElementId: "scene-plan-1",
      compositionStatus: "composed",
      wouldCompose: true,
    })
  })

  test("serializes concurrent scene lifecycle updates without losing either plan element", async () => {
    const dir = await fixtureDir()
    await createProject(dir, blankProject(dir))

    await updateProject(dir, (current) => ({
      ...current,
      editingDocument: {
        ...current.editingDocument,
        elements: [
          {
            id: "scene-plan-1",
            sectionId: "section-1",
            type: "scene",
            source: "automatic",
            status: "approved",
            fromSegment: 0,
            toSegment: 0,
            reason: "first",
          },
          {
            id: "scene-plan-2",
            sectionId: "section-1",
            type: "scene",
            source: "automatic",
            status: "approved",
            fromSegment: 1,
            toSegment: 1,
            reason: "second",
          },
        ],
      },
    }))

    await Promise.all([
      updateProject(dir, (current) => ({
        ...current,
        editingDocument: {
          ...current.editingDocument,
          elements: current.editingDocument.elements.map((element) =>
            element.id === "scene-plan-1"
              ? { ...element, renderStatus: "rendered" as const }
              : element
          ),
        },
      })),
      updateProject(dir, (current) => ({
        ...current,
        editingDocument: {
          ...current.editingDocument,
          elements: current.editingDocument.elements.map((element) =>
            element.id === "scene-plan-2"
              ? {
                  ...element,
                  renderStatus: "failed" as const,
                  renderError: "timeout",
                }
              : element
          ),
        },
      })),
    ])

    const stored = await readStoredProject(dir)
    expect(stored.editingDocument.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "scene-plan-1",
          renderStatus: "rendered",
        }),
        expect.objectContaining({
          id: "scene-plan-2",
          renderStatus: "failed",
          renderError: "timeout",
        }),
      ])
    )
  })

  test("a project before cleanup is approved gets an empty document", async () => {
    const dir = await fixtureDir()
    const project = await createProject(dir, blankProject(dir))
    const hydrated = await hydrate(dir, project)

    const document = buildEditingDocument(hydrated)

    expect(document).toMatchObject({
      script: null,
      entries: [],
      titles: [],
      sections: [],
      elements: [],
      analysisAt: null,
      reviewedAt: null,
    })
  })

  test("a project.json written before this feature existed still parses and gets an empty document", () => {
    // What's actually on disk for every project created before this PR — no
    // migration should be required to read it.
    const legacy = {
      version: 1,
      id: "proj_1",
      path: "/projects/demo",
      name: "Demo",
      createdAt: new Date().toISOString(),
      fps: 30,
      media: [],
      transcript: { words: [] },
      spans: [],
      cleanupApprovedAt: null,
      styleGuide: { palette: [], fontStack: "", motion: "", notes: "" },
      scenes: [],
      copy: null,
    }

    const parsed = StoredProjectSchema.parse(legacy)
    const document = buildEditingDocument({ ...parsed, scenes: [] })

    expect(document).toMatchObject({
      script: null,
      entries: [],
      titles: [],
      sections: [],
      elements: [],
      analysisAt: null,
      reviewedAt: null,
    })
  })
})

describe("buildDocumentSections, the screenplay layout for issue #5", () => {
  test("interleaves the script with TITRE, ZOOM and SCÈNE B-ROLL markers, section by section", async () => {
    const dir = await fixtureDir()
    await createProject(dir, blankProject(dir, [media()]))

    await updateProject(dir, (current) => ({
      ...current,
      transcript: {
        words: [
          { w: "Hello", start: 0, end: 1, file: "01.MP4" },
          { w: "world", start: 1, end: 2, file: "01.MP4" },
          { w: "today", start: 5, end: 6, file: "01.MP4" },
          { w: "onward", start: 10, end: 11, file: "01.MP4" },
          { w: "end", start: 20, end: 21, file: "01.MP4" },
        ],
      },
      spans: [{ start: 0, end: 21, action: "keep" }],
      cleanupApprovedAt: new Date().toISOString(),
      editingDocument: {
        sections: [
          {
            id: "section-1",
            fromSegment: 0,
            toSegment: 1,
            name: "Opening",
            reason: "starts the subject",
            source: "automatic",
          },
          {
            id: "section-2",
            fromSegment: 2,
            toSegment: 3,
            name: "Middle",
            reason: "develops the idea",
            source: "automatic",
          },
        ],
        elements: [
          {
            id: "title_1",
            sectionId: "section-1",
            type: "title",
            source: "manual",
            status: "approved",
            fromSegment: 0,
            toSegment: 0,
            reason: "Added manually",
            titleText: "The agents",
            htmlPath: null,
            exportPath: null,
          },
          {
            id: "scene-plan-1",
            sectionId: "section-1",
            type: "scene",
            source: "automatic",
            status: "approved",
            fromSegment: 1,
            toSegment: 1,
            reason: "illustrate today",
            sceneId: "scene_01",
          },
          {
            id: "zoom-plan-1",
            sectionId: "section-2",
            type: "zoom",
            source: "automatic",
            status: "proposed",
            fromSegment: 2,
            toSegment: 2,
            reason: "punctuate onward",
            zoomPreset: "medium",
          },
          {
            id: "scene-plan-2",
            sectionId: "section-2",
            type: "scene",
            source: "automatic",
            status: "approved",
            fromSegment: 3,
            toSegment: 3,
            reason: "illustrate the end",
          },
        ],
        analysisAt: new Date().toISOString(),
        reviewedAt: null,
      },
      scenes: [{ ...scene("scene_01", 5), planElementId: "scene-plan-1" }],
    }))

    const project = await hydrate(dir, await readStoredProject(dir))
    const document = buildEditingDocument(project)
    const structured = buildDocumentSections(project, document)

    expect(structured.unplaced).toEqual([])
    expect(structured.sections).toHaveLength(2)

    const [opening, middle] = structured.sections
    expect(opening.blocks.map((block) => block.kind)).toEqual([
      "title",
      "text",
      "scene",
      "text",
    ])
    expect(blockText(opening.blocks[1])).toBe("Hello world")
    expect(opening.blocks[2]).toMatchObject({ id: "scene_01" })
    expect(blockText(opening.blocks[3])).toBe("today")

    expect(middle.blocks.map((block) => block.kind)).toEqual([
      "zoom",
      "text",
      "scene",
      "text",
    ])
    expect(middle.blocks[0]).toMatchObject({
      id: "zoom-plan-1",
      status: "proposed",
      preset: "medium",
    })
    expect(blockText(middle.blocks[1])).toBe("onward")
    expect(middle.blocks[2]).toMatchObject({
      id: "scene-plan-2",
      status: "approved",
    })
    expect(blockText(middle.blocks[3])).toBe("end")
  })

  test("is empty when no structural plan has been proposed yet", async () => {
    const dir = await fixtureDir()
    await createProject(dir, blankProject(dir))
    await updateProject(dir, (current) => ({
      ...current,
      spans: [{ start: 0, end: 1, action: "keep" }],
      cleanupApprovedAt: new Date().toISOString(),
    }))

    const project = await hydrate(dir, await readStoredProject(dir))
    const document = buildEditingDocument(project)

    expect(buildDocumentSections(project, document)).toEqual({
      sections: [],
      unplaced: [],
    })
  })
})
