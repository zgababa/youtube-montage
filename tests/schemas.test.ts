import { describe, expect, test } from "bun:test"

import { StoredProjectSchema } from "../src/mastra/schemas"

describe("StoredProjectSchema", () => {
  test("parses a project.json written before maxSilenceSec/timelineApprovedAt existed", () => {
    // What's actually on disk for every project created before this PR —
    // idea.md §7: projects are portable, so an older build's file has to keep
    // parsing rather than crash the whole app on read.
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

    expect(parsed.maxSilenceSec).toBe(0.3)
    expect(parsed.timelineApprovedAt).toBeNull()
    expect(parsed.editingDocument).toEqual({
      sections: [],
      elements: [],
      analysisAt: null,
      reviewedAt: null,
    })
  })
})
