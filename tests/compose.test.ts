import { describe, expect, test } from "bun:test"

import { buildComposeRequest, composeVideo } from "../src/mastra/lib/compose"
import { cutVideoPath, finalVideoPath } from "../src/mastra/lib/paths"
import type { HyperFramesClient } from "../src/mastra/lib/hyperframes"
import type { MediaFile, StoredProject, StoredScene, Word } from "../src/mastra/schemas"

function word(w: string, start: number, end: number, file = "raw/a.mp4"): Word {
  return { w, start, end, file }
}

function media(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    path: "raw/a.mp4",
    durationSec: 120,
    hasAudio: true,
    hasVideo: true,
    transcribe: true,
    offsetSec: 0,
    voices: null,
    ...overrides,
  }
}

function scene(overrides: Partial<StoredScene> = {}): StoredScene {
  return {
    id: "scene_01",
    scriptStart: 0,
    scriptEnd: 1,
    windowSec: 1,
    coversLine: "The agent picks up the job from the queue.",
    sourceFile: "raw/a.mp4",
    intent: "explain the queue",
    type: "concept",
    status: "approved",
    htmlPath: null,
    exportPath: null,
    measuredDurationSec: null,
    beatSheetEntry: {
      cardId: "concept-headline",
      slots: [{ slotId: "headline", text: "The queue, explained" }],
      entryAt: 0,
    },
    ...overrides,
  }
}

function project(overrides: Partial<StoredProject> = {}): StoredProject {
  return {
    version: 1,
    id: "proj_1",
    path: "/projects/demo",
    name: "Demo",
    createdAt: new Date().toISOString(),
    fps: 30,
    media: [media()],
    transcriptionHints: { prompt: "", keyterms: [] },
    transcript: { words: [word("hi", 0, 1)] },
    spans: [{ start: 0, end: 1, action: "keep" }],
    cleanupApprovedAt: "2026-01-01T00:00:00.000Z",
    maxSilenceSec: 0.3,
    timelineApprovedAt: "2026-01-01T00:00:00.000Z",
    cutAt: "2026-01-01T00:00:00.000Z",
    compositeApprovedAt: null,
    styleGuide: { palette: [], fontStack: "", motion: "", notes: "" },
    styleRef: "default",
    scenes: [scene()],
    copy: null,
    ...overrides,
  }
}

describe("buildComposeRequest", () => {
  test("places a realized, approved scene's card at its remapped position", () => {
    const { request, skipped } = buildComposeRequest(project())

    expect(skipped).toEqual([])
    expect(request.cutVideoPath).toBe(cutVideoPath("/projects/demo"))
    expect(request.outputPath).toBe(finalVideoPath("/projects/demo"))
    expect(request.style.id).toBe("default")
    expect(request.cards).toEqual([
      {
        sceneId: "scene_01",
        cardId: "concept-headline",
        slots: [{ slotId: "headline", text: "The queue, explained" }],
        atSec: 0,
      },
    ])
  })

  test("ignores scenes that aren't approved, or never realized", () => {
    const p = project({
      scenes: [
        scene({ id: "pending", status: "ready" }),
        scene({ id: "unrealized", status: "approved", beatSheetEntry: null }),
      ],
    })

    const { request } = buildComposeRequest(p)

    expect(request.cards).toEqual([])
  })

  test("a scene whose window falls on cut content is reported, not silently dropped", () => {
    // A single word at [0, 1) keeps only that stretch; a scene claiming a
    // window past it (scriptStart 5) has no kept footage under it at all.
    const p = project({
      scenes: [scene({ id: "gone", scriptStart: 5, scriptEnd: 6 })],
    })

    const { request, skipped } = buildComposeRequest(p)

    expect(request.cards).toEqual([])
    expect(skipped).toEqual(["gone"])
  })

  test("one skipped entry doesn't block the rest from composing", () => {
    const words = [word("a", 0, 1), word("b", 10, 11)]
    const p = project({
      transcript: { words },
      spans: [
        { start: 0, end: 1, action: "keep" },
        { start: 1, end: 10, action: "cut", category: "filler" },
        { start: 10, end: 11, action: "keep" },
      ],
      scenes: [
        scene({ id: "ok", scriptStart: 10, scriptEnd: 11, windowSec: 1 }),
        scene({ id: "gone", scriptStart: 3, scriptEnd: 4, windowSec: 1 }),
      ],
    })

    const { request, skipped } = buildComposeRequest(p)

    expect(request.cards.map((card) => card.sceneId)).toEqual(["ok"])
    expect(skipped).toEqual(["gone"])
  })

  test("throws on an unresolvable style reference, rather than composing without one", () => {
    const p = project({ styleRef: "no-such-channel" })

    expect(() => buildComposeRequest(p)).toThrow()
  })
})

describe("composeVideo", () => {
  test("hands the built request to the injected client and reports what it placed", async () => {
    let received: unknown
    const client: HyperFramesClient = {
      async compose(request) {
        received = request
        return { outputPath: finalVideoPath("/projects/demo") }
      },
    }

    const result = await composeVideo(project(), client)

    expect(result.outputPath).toBe(finalVideoPath("/projects/demo"))
    expect(result.placedCount).toBe(1)
    expect(result.skipped).toEqual([])
    expect(received).toMatchObject({ cards: [{ sceneId: "scene_01" }] })
  })

  test("propagates a HyperFrames placement failure rather than returning a partial success", async () => {
    const client: HyperFramesClient = {
      async compose() {
        throw new Error("card unknown to this deck")
      },
    }

    await expect(composeVideo(project(), client)).rejects.toThrow(
      "card unknown to this deck"
    )
  })
})
