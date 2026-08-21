import { describe, expect, test } from "bun:test"

import { buildFcpxml, secondsToRational } from "../src/mastra/lib/fcpxml"
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
    styleGuide: { palette: [], fontStack: "", motion: "", notes: "" },
    scenes: [],
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
