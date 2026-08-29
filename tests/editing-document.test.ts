import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { buildEditingDocument } from "../lib/project"
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

  test("a project before cleanup is approved gets an empty document", async () => {
    const dir = await fixtureDir()
    const project = await createProject(dir, blankProject(dir))
    const hydrated = await hydrate(dir, project)

    const document = buildEditingDocument(hydrated)

    expect(document).toEqual({ script: null, entries: [] })
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

    expect(document).toEqual({ script: null, entries: [] })
  })
})
