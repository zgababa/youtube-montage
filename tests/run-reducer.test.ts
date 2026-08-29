import { describe, expect, test } from "bun:test"

import { applyPatch, reduceParts } from "../lib/run-reducer"
import type { PipelineUIMessage } from "../src/mastra/stream/contract"
import type { Project, Scene, SceneStatus } from "../lib/types"

type Part = PipelineUIMessage["parts"][number]

function scene(id: string, status: SceneStatus, start: number): Scene {
  return {
    id,
    scriptStart: start,
    scriptEnd: start + 20,
    windowSec: 20,
    coversLine: `line for ${id}`,
    sourceFile: "01.MP4",
    intent: "something visual",
    type: "concept",
    status,
    htmlPath: null,
    exportPath: null,
    measuredDurationSec: null,
    html: null,
  }
}

/** One message carrying the parts a run would have emitted so far. */
function run(...parts: Part[]): PipelineUIMessage[] {
  return [
    {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "data-run",
          data: {
            runId: "r1",
            projectPath: "/tmp/p",
            status: "running",
            startedAt: "2026-08-02T10:00:00.000Z",
          },
        } as Part,
        ...parts,
      ],
    },
  ]
}

const generating = {
  type: "data-step",
  data: { id: "generate", status: "running" },
} as Part

function generateRow(messages: PipelineUIMessage[]) {
  const { run: reduced } = reduceParts(messages, { streaming: true })
  return reduced?.steps.find((step) => step.id === "generate")
}

describe("the generate row", () => {
  test("counts the scenes that are done, not the ones that reported", () => {
    const row = generateRow(
      run(generating, {
        type: "data-scenes",
        data: {
          scenes: [
            scene("scene_01", "ready", 0),
            scene("scene_02", "generating", 20),
            scene("scene_03", "pending", 40),
            scene("scene_04", "failed", 60),
          ],
        },
      } as Part)
    )

    // Failed still counts: its generation is over, which is what the bar tracks.
    expect(row?.detail).toBe("2 of 4 scenes")
    expect(row?.progress).toBe(50)
  })

  test("follows a scene as it moves, rather than appending it twice", () => {
    const placed = {
      type: "data-scenes",
      data: {
        scenes: [
          scene("scene_01", "pending", 0),
          scene("scene_02", "pending", 20),
        ],
      },
    } as Part

    expect(generateRow(run(generating, placed))?.detail).toBe("0 of 2 scenes")

    const finished = {
      type: "data-scene",
      data: { ...scene("scene_01", "ready", 0), html: "<html></html>" },
    } as Part

    expect(generateRow(run(generating, placed, finished))?.detail).toBe(
      "1 of 2 scenes"
    )
  })

  test("is not waiting once the fan-out has reported itself done", () => {
    const row = generateRow(
      run({
        type: "data-step",
        data: { id: "generate", status: "success" },
      } as Part)
    )

    expect(row?.status).toBe("success")
    // The count belongs to a phase that is still running. A finished row keeps
    // whatever the step itself last said.
    expect(row?.detail).toBeUndefined()
  })

  test("reports no fraction before any scene has been placed", () => {
    const row = generateRow(run(generating))

    expect(row?.status).toBe("running")
    expect(row?.progress).toBeUndefined()
    expect(row?.detail).toBeUndefined()
  })
})

describe("a scene's document", () => {
  const generated = {
    type: "data-scene",
    data: { ...scene("scene_01", "ready", 0), html: "<h1>generated</h1>" },
  } as Part

  test("survives a report that doesn't carry one", () => {
    // What `review` emits when the user approves a scene: the new status, and
    // `html: null` because it isn't re-sending the document it just approved.
    const approved = {
      type: "data-scene",
      data: { ...scene("scene_01", "approved", 0), html: null },
    } as Part

    const { patch } = reduceParts(run(generated, approved))
    const [only] = patch.scenes!

    expect(only.status).toBe("approved")
    // Taking the null literally blanked the preview the moment you approved.
    expect(only.html).toBe("<h1>generated</h1>")
  })

  test("is replaced when a later report actually carries one", () => {
    const regenerated = {
      type: "data-scene",
      data: { ...scene("scene_01", "ready", 0), html: "<h1>second go</h1>" },
    } as Part

    const { patch } = reduceParts(run(generated, regenerated))

    expect(patch.scenes![0].html).toBe("<h1>second go</h1>")
  })

  test("stays null for a scene that never produced one", () => {
    const failed = {
      type: "data-scene",
      data: { ...scene("scene_02", "failed", 20), html: null },
    } as Part

    const { patch } = reduceParts(run(failed))

    expect(patch.scenes![0].html).toBeNull()
  })
})

function project(scenes: Scene[]): Project {
  return {
    version: 1,
    id: "p1",
    path: "/tmp/p",
    name: "p",
    createdAt: "2026-08-02T10:00:00.000Z",
    fps: 30,
    media: [],
    transcriptionHints: { prompt: "", keyterms: [] },
    transcript: { words: [] },
    spans: [],
    cleanupApprovedAt: null,
    maxSilenceSec: 0.3,
    timelineApprovedAt: null,
    compositeApprovedAt: null,
    styleGuide: { palette: [], fontStack: "", motion: "", notes: "" },
    scenes,
    editingDocument: {
      sections: [],
      elements: [],
      analysisAt: null,
      reviewedAt: null,
    },
    titleAnnotations: [],
    copy: null,
  }
}

describe("applyPatch", () => {
  test("folds the structural plan into the project patch", () => {
    const document = {
      sections: [
        {
          id: "section_01",
          fromSegment: 0,
          toSegment: 1,
          name: "Opening",
          reason: "starts the subject",
          source: "automatic" as const,
        },
      ],
      elements: [],
      analysisAt: null,
      reviewedAt: null,
    }

    const { patch } = reduceParts(
      run({
        type: "data-document",
        data: { document },
      } as Part)
    )

    expect(patch.editingDocument).toEqual(document)
  })

  test("merges a partial scenes patch instead of replacing the array", () => {
    // The shape a reconnect + one regenerate produces: the client only ever
    // saw scene_02's `data-scene` event, but the disk copy has all three.
    const onDisk = project([
      scene("scene_01", "ready", 0),
      scene("scene_02", "ready", 20),
      scene("scene_03", "ready", 40),
    ])

    const merged = applyPatch(onDisk, {
      scenes: [scene("scene_02", "generating", 20)],
    })

    expect(merged.scenes.map((s) => s.id)).toEqual([
      "scene_01",
      "scene_02",
      "scene_03",
    ])
    expect(merged.scenes.find((s) => s.id === "scene_02")?.status).toBe(
      "generating"
    )
  })

  test("still overlays non-scene fields wholesale", () => {
    const onDisk = project([scene("scene_01", "ready", 0)])
    const merged = applyPatch(onDisk, {
      cleanupApprovedAt: "2026-08-02T00:00:00.000Z",
    })

    expect(merged.cleanupApprovedAt).toBe("2026-08-02T00:00:00.000Z")
    expect(merged.scenes).toEqual(onDisk.scenes)
  })
})
