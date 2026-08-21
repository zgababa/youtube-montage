import { describe, expect, test } from "bun:test"

import {
  buildFcpxml,
  placeOverlays,
  secondsToRational,
  type OverlayScene,
} from "../src/mastra/lib/fcpxml"
import type { TimelineRun } from "../src/mastra/lib/timeline"
import type { MediaFile, StoredProject } from "../src/mastra/schemas"

function media(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    path: "raw/01 - a.mp4",
    durationSec: 120,
    hasAudio: true,
    hasVideo: true,
    transcribe: true,
    offsetSec: 0,
    voices: null,
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
    transcript: { words: [] },
    spans: [],
    cleanupApprovedAt: null,
    maxSilenceSec: 0.3,
    timelineApprovedAt: null,
    compositeApprovedAt: null,
    styleGuide: { palette: [], fontStack: "", motion: "", notes: "" },
    scenes: [],
    titleAnnotations: [],
    copy: null,
    ...overrides,
  }
}

describe("secondsToRational", () => {
  test("known fps fractions", () => {
    expect(secondsToRational(1 / 24, 24)).toBe("1/24s")
    expect(secondsToRational(1 / 25, 25)).toBe("1/25s")
    expect(secondsToRational(1 / 30, 30)).toBe("1/30s")
    // 23.976 fps: one frame is exactly 1001/24000s.
    expect(secondsToRational(1001 / 24000, 23.976)).toBe("1001/24000s")
    // 29.97 fps: one frame is exactly 1001/30000s.
    expect(secondsToRational(1001 / 30000, 29.97)).toBe("1001/30000s")
  })

  test("zero seconds is the literal 0s", () => {
    expect(secondsToRational(0, 30)).toBe("0s")
  })
})

describe("buildFcpxml", () => {
  test("one asset-clip per run, in order", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 2 },
      { file: "raw/01 - a.mp4", sourceStart: 5, sourceEnd: 7 },
    ]

    const xml = buildFcpxml(project(), runs)

    const clips = [...xml.matchAll(/<asset-clip\b[^>]*>/g)]
    expect(clips).toHaveLength(2)
  })

  test("one asset per distinct file, with hasAudio reflecting the media entry", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 2 },
      { file: "raw/02 - b.mp4", sourceStart: 0, sourceEnd: 3 },
      // Same file again — must not duplicate the <asset>.
      { file: "raw/01 - a.mp4", sourceStart: 5, sourceEnd: 7 },
    ]

    const proj = project({
      media: [
        media({ path: "raw/01 - a.mp4", hasAudio: true }),
        media({ path: "raw/02 - b.mp4", hasAudio: false }),
      ],
    })

    const xml = buildFcpxml(proj, runs)

    const assets = [...xml.matchAll(/<asset\s[^>]*>/g)]
    expect(assets).toHaveLength(2)

    const assetA = assets.find((m) => m[0].includes("01 - a.mp4"))
    const assetB = assets.find((m) => m[0].includes("02 - b.mp4"))
    // Asserted positively on both sides: `not.toMatch(/hasAudio="1"/)` also
    // passes when the attribute went missing entirely.
    expect(assetA?.[0]).toMatch(/hasAudio="1"/)
    expect(assetB?.[0]).toMatch(/hasAudio="0"/)
  })

  test("a run whose file isn't in project.media is refused, not guessed at", () => {
    const runs: TimelineRun[] = [
      { file: "raw/99 - missing.mp4", sourceStart: 0, sourceEnd: 2 },
    ]

    expect(() => buildFcpxml(project(), runs)).toThrow(/project\.media/)
  })

  test("clip durations match the run lengths", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 2 },
    ]

    const xml = buildFcpxml(project({ fps: 25 }), runs)

    const [clip] = [...xml.matchAll(/<asset-clip\b[^>]*>/g)]
    expect(clip[0]).toContain(`duration="${secondsToRational(2, 25)}"`)
  })

  test("file paths are resolved to absolute file:// URLs, on a media-rep child", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 1 },
    ]

    const xml = buildFcpxml(project({ path: "/projects/demo" }), runs)

    // Spaces (and the rest of a filename's non-ASCII characters) are
    // percent-encoded in the URL, per the FCPXML spec — a raw space in `src`
    // is what makes some importers fail to resolve the media at all.
    //
    // And the URL lives on `<media-rep>`, not as an `<asset src="…">`
    // attribute: that attribute is gone from the 1.9 DTD this document
    // declares, so an importer reading 1.9 would find no media to relink.
    expect(xml).toContain(
      '<media-rep kind="original-media" src="file:///projects/demo/raw/01%20-%20a.mp4"/>'
    )
    expect(xml).not.toMatch(/<asset\s[^>]*\ssrc=/)
  })

  test("clip offsets tile the spine exactly, with no rounding drift", () => {
    // Durations that don't land on a frame boundary at 25 fps: 1.05s is 26.25
    // frames. Rounding each offset from a running float sum instead of summing
    // the rounded durations opens a one-frame gap a few clips in.
    const runs: TimelineRun[] = Array.from({ length: 6 }, (_, i) => ({
      file: "raw/01 - a.mp4",
      sourceStart: i * 2,
      sourceEnd: i * 2 + 1.05,
    }))

    const xml = buildFcpxml(project({ fps: 25 }), runs)
    const clips = [...xml.matchAll(/<asset-clip\b[^>]*>/g)].map((m) => m[0])

    // "num/dens" back to a whole number of 25 fps frames. The generator
    // reduces the fraction, so 50 frames comes back as "2/1s", not "50/25s".
    const frames = (value: string) => {
      if (value === "0s") return 0
      const [num, den] = value.replace(/s$/, "").split("/").map(Number)
      return (num * 25) / den
    }
    const attr = (clip: string, name: string) =>
      clip.match(new RegExp(`${name}="([^"]+)"`))![1]

    let expected = 0
    for (const clip of clips) {
      expect(frames(attr(clip, "offset"))).toBe(expected)
      expected += frames(attr(clip, "duration"))
    }

    const sequence = xml.match(/<sequence[^>]*>/)![0]
    expect(frames(attr(sequence, "duration"))).toBe(expected)
  })

  test("declares the FCPXML version DaVinci Resolve 21 parses reliably", () => {
    const xml = buildFcpxml(project(), [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 1 },
    ])

    expect(xml).toContain('<fcpxml version="1.9">')
  })
})

function overlay(overrides: Partial<OverlayScene> = {}): OverlayScene {
  return {
    id: "scene_01",
    sourceFile: "raw/01 - a.mp4",
    scriptStart: 3,
    durationSec: 2,
    exportPath: "exports/scene_01.mov",
    ...overrides,
  }
}

describe("placeOverlays", () => {
  test("places a scene in the run whose source range contains its scriptStart", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 2 },
      { file: "raw/01 - a.mp4", sourceStart: 5, sourceEnd: 10 },
    ]

    const { placed, skipped } = placeOverlays(runs, [overlay({ scriptStart: 6 })])

    expect(skipped).toEqual([])
    expect(placed).toHaveLength(1)
    expect(placed[0].runIndex).toBe(1)
  })

  test("skips a scene whose scriptStart falls outside every run — content that ended up cut", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 2 },
    ]

    const { placed, skipped } = placeOverlays(runs, [overlay({ scriptStart: 50 })])

    expect(placed).toEqual([])
    expect(skipped).toEqual(["scene_01"])
  })

  test("skips a scene on a different source file even if the timecodes overlap", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 10 },
    ]

    const { placed, skipped } = placeOverlays(runs, [
      overlay({ sourceFile: "raw/02 - b.mp4", scriptStart: 3 }),
    ])

    expect(placed).toEqual([])
    expect(skipped).toEqual(["scene_01"])
  })

  test("carries a scene into the next run instead of clipping it at the run boundary", () => {
    // The exact shape a trimmed natural pause produces: two runs of the same
    // file, spine-adjacent, that aren't one run only because the gap between
    // them was long enough to trim (buildKeptRuns). A scene generated to fill
    // a 6s window here must not lose its last 3s just because the pause in
    // the middle became a run boundary.
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 5 },
      { file: "raw/01 - a.mp4", sourceStart: 10, sourceEnd: 15 },
    ]

    const { placed, skipped } = placeOverlays(runs, [
      overlay({ scriptStart: 4, durationSec: 6 }),
    ])

    expect(skipped).toEqual([])
    expect(placed).toHaveLength(2)

    // First fragment: 1s left in run 0 past scriptStart=4, from the start of
    // the overlay's own clip.
    expect(placed[0]).toMatchObject({
      runIndex: 0,
      runOffset: 4,
      sourceOffset: 0,
      durationSec: 1,
    })
    // Second fragment: the remaining 5s, continuing from 1s into the
    // overlay's own clip, at the very start of run 1.
    expect(placed[1]).toMatchObject({
      runIndex: 1,
      runOffset: 10,
      sourceOffset: 1,
      durationSec: 5,
    })
  })

  test("truncates the last fragment rather than dropping the scene when the kept footage runs out", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 5 },
    ]

    const { placed } = placeOverlays(runs, [
      overlay({ scriptStart: 4, durationSec: 10 }),
    ])

    expect(placed).toHaveLength(1)
    // Only 1s left in the only run past scriptStart=4.
    expect(placed[0].durationSec).toBe(1)
  })
})

describe("buildFcpxml with scene overlays", () => {
  test("nests a connected clip inside the run it was placed in, on lane 1", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 2 },
      { file: "raw/01 - a.mp4", sourceStart: 5, sourceEnd: 10 },
    ]

    const xml = buildFcpxml(project(), runs, [overlay({ scriptStart: 6 })])

    // The connected clip's offset is scriptStart itself, in the same
    // coordinate system as the parent's own `start` — not translated. Its
    // own `start` is 0s: this is the scene's first (and only) fragment.
    const connected = xml.match(/<asset-clip[^>]*lane="1"[^>]*\/>/)
    expect(connected?.[0]).toContain(`offset="${secondsToRational(6, 30)}"`)
    expect(connected?.[0]).toContain('start="0s"')

    // Nested inside the second run's clip (start=5s), not the first.
    const secondRunClip = xml.match(
      new RegExp(
        `<asset-clip[^>]*start="${secondsToRational(5, 30).replace(/\//g, "\\/")}"[^>]*>[\\s\\S]*?<\\/asset-clip>`
      )
    )
    expect(secondRunClip?.[0]).toContain('lane="1"')
  })

  test("writes a video-only asset for the overlay, referencing its exportPath", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 10 },
    ]

    const xml = buildFcpxml(
      project({ path: "/projects/demo" }),
      runs,
      [overlay({ scriptStart: 3, exportPath: "exports/scene_01.mov" })]
    )

    expect(xml).toContain(
      '<media-rep kind="original-media" src="file:///projects/demo/exports/scene_01.mov"/>'
    )
    const sceneAsset = xml.match(/<asset id="scene-asset-scene_01"[^>]*>/)
    expect(sceneAsset?.[0]).toContain('hasAudio="0"')
    expect(sceneAsset?.[0]).toContain('hasVideo="1"')
  })

  test("a scene split across a run boundary becomes two connected clips, seamlessly continuing", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 5 },
      { file: "raw/01 - a.mp4", sourceStart: 10, sourceEnd: 15 },
    ]

    const xml = buildFcpxml(project(), runs, [
      overlay({ scriptStart: 4, durationSec: 6 }),
    ])

    const connected = [...xml.matchAll(/<asset-clip[^>]*lane="1"[^>]*\/>/g)].map(
      (m) => m[0]
    )
    expect(connected).toHaveLength(2)

    // Same asset, same scene — just two windows into it.
    expect(connected[0]).toContain('ref="scene-asset-scene_01"')
    expect(connected[1]).toContain('ref="scene-asset-scene_01"')

    expect(connected[0]).toContain(`offset="${secondsToRational(4, 30)}"`)
    expect(connected[0]).toContain('start="0s"')
    expect(connected[0]).toContain(`duration="${secondsToRational(1, 30)}"`)

    expect(connected[1]).toContain(`offset="${secondsToRational(10, 30)}"`)
    // Picks up exactly where the first fragment left off.
    expect(connected[1]).toContain(`start="${secondsToRational(1, 30)}"`)
    expect(connected[1]).toContain(`duration="${secondsToRational(5, 30)}"`)

    // One asset for the whole scene, not one per fragment.
    expect(
      [...xml.matchAll(/<asset id="scene-asset-scene_01"/g)]
    ).toHaveLength(1)
  })

  test("a scene that can't be placed doesn't appear in the spine at all", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 2 },
    ]

    const xml = buildFcpxml(project(), runs, [overlay({ scriptStart: 50 })])

    expect(xml).not.toContain("lane=")
    expect(xml).not.toContain("scene-asset-scene_01")
  })
})

const WHITE_ASSET_REF = 'ref="asset-white-backing"'

describe("buildFcpxml with a white backing", () => {
  const backing = { exportPath: "exports/_white-backing.mov", durationSec: 30 }

  test("adds a lane-1 backing clip under the scene, which moves to lane 2", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 10 },
    ]

    const xml = buildFcpxml(
      project(),
      runs,
      [overlay({ scriptStart: 3, durationSec: 4 })],
      backing
    )

    const connected = [...xml.matchAll(/<asset-clip[^>]*lane="\d"[^>]*\/>/g)].map(
      (m) => m[0]
    )
    expect(connected).toHaveLength(2)

    const white = connected.find((c) => c.includes(WHITE_ASSET_REF))!
    const scene = connected.find((c) => c.includes('ref="scene-asset-scene_01"'))!

    expect(white).toContain('lane="1"')
    expect(scene).toContain('lane="2"')

    // Same offset and duration, so the white clip exactly backs the scene.
    const offset = `offset="${secondsToRational(3, 30)}"`
    const duration = `duration="${secondsToRational(4, 30)}"`
    expect(white).toContain(offset)
    expect(white).toContain(duration)
    expect(scene).toContain(offset)
    expect(scene).toContain(duration)

    // The backing clip always plays from its own start — any slice of a
    // solid colour looks like any other.
    expect(white).toContain('start="0s"')
  })

  test("without a backing, the scene alone sits on lane 1 — unchanged from before", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 10 },
    ]

    const xml = buildFcpxml(project(), runs, [overlay({ scriptStart: 3 })], null)

    const connected = [...xml.matchAll(/<asset-clip[^>]*lane="\d"[^>]*\/>/g)]
    expect(connected).toHaveLength(1)
    expect(connected[0][0]).toContain('lane="1"')
  })

  test("one white clip backs every fragment of a scene split across a run boundary", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 5 },
      { file: "raw/01 - a.mp4", sourceStart: 10, sourceEnd: 15 },
    ]

    const xml = buildFcpxml(
      project(),
      runs,
      [overlay({ scriptStart: 4, durationSec: 6 })],
      backing
    )

    expect(
      [...xml.matchAll(new RegExp(WHITE_ASSET_REF, "g"))]
    ).toHaveLength(2)
    // Still exactly one <asset> for the backing clip, referenced twice.
    expect(
      [...xml.matchAll(/<asset id="asset-white-backing"/g)]
    ).toHaveLength(1)
  })

  test("skips the backing entirely when nothing gets placed", () => {
    const runs: TimelineRun[] = [
      { file: "raw/01 - a.mp4", sourceStart: 0, sourceEnd: 2 },
    ]

    const xml = buildFcpxml(
      project(),
      runs,
      [overlay({ scriptStart: 50 })],
      backing
    )

    expect(xml).not.toContain("white-backing")
  })
})
