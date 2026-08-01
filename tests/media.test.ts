import { describe, expect, test } from "bun:test"

import {
  anchorWords,
  assignRoles,
  type ProbedFile,
} from "../src/mastra/lib/media"
import type { MediaFile } from "../src/mastra/schemas"

const camera: ProbedFile = {
  path: "raw/a-cam-01.mp4",
  durationSec: 1800,
  hasAudio: true,
  hasVideo: true,
}

const mic: ProbedFile = {
  path: "raw/audio.mp3",
  durationSec: 1810,
  hasAudio: true,
  hasVideo: false,
}

const screen: ProbedFile = {
  path: "raw/screen.mp4",
  durationSec: 600,
  hasAudio: true,
  hasVideo: true,
}

const bRoll: ProbedFile = {
  path: "raw/cutaway.mp4",
  durationSec: 30,
  hasAudio: false,
  hasVideo: true,
}

function by(media: MediaFile[], path: string) {
  const file = media.find((entry) => entry.path === path)
  if (!file) throw new Error(`no ${path}`)
  return file
}

describe("assignRoles", () => {
  /**
   * The setup this whole module exists for: a camera recording scratch audio
   * while a separate mic records the good audio. Transcribing both would put
   * the entire talk into the script twice.
   */
  test("pairs a lone mic track with the lone camera clip", () => {
    const media = assignRoles([camera, mic])

    expect(by(media, "raw/audio.mp3").transcribe).toBe(true)
    expect(by(media, "raw/audio.mp3").voices).toBe("raw/a-cam-01.mp4")
    expect(by(media, "raw/a-cam-01.mp4").transcribe).toBe(false)
  })

  test("the mic is the source, not the camera", () => {
    // Better audio means better word timings, so the pairing has to run this
    // way round — the camera is footage, the mic is the transcript.
    const sources = assignRoles([camera, mic]).filter((file) => file.transcribe)

    expect(sources.map((file) => file.path)).toEqual(["raw/audio.mp3"])
  })

  test("a self-contained screen recording transcribes on its own", () => {
    const media = assignRoles([screen])

    expect(by(media, "raw/screen.mp4").transcribe).toBe(true)
    expect(by(media, "raw/screen.mp4").voices).toBeNull()
  })

  test("silent footage is never a source", () => {
    expect(by(assignRoles([camera, bRoll]), "raw/cutaway.mp4").transcribe).toBe(
      false
    )
  })

  /**
   * Ambiguity is left loud on purpose. Pairing the wrong two files produces a
   * result that still looks plausible; transcribing everything produces a
   * visibly doubled script and a "check" badge in the UI.
   */
  test("does not guess when two clips could be the anchor", () => {
    const media = assignRoles([camera, screen, mic])
    const sources = media.filter((file) => file.transcribe)

    expect(sources).toHaveLength(3)
    expect(media.every((file) => file.voices === null)).toBe(true)
  })

  test("does not guess with two separate audio tracks", () => {
    const second = { ...mic, path: "raw/music.mp3" }
    const media = assignRoles([camera, mic, second])

    expect(media.filter((file) => file.transcribe)).toHaveLength(3)
  })

  test("carries a measured offset through a re-scan", () => {
    // Scan runs on every single run. Re-deriving roles from scratch each time
    // would silently discard the sync the user measured by hand.
    const previous = assignRoles([camera, mic]).map((file) =>
      file.path === "raw/audio.mp3" ? { ...file, offsetSec: -8.2 } : file
    )

    const media = assignRoles([camera, mic], previous)

    expect(by(media, "raw/audio.mp3").offsetSec).toBe(-8.2)
    expect(by(media, "raw/audio.mp3").voices).toBe("raw/a-cam-01.mp4")
  })

  test("keeps a user's override of the automatic pairing", () => {
    const previous = assignRoles([camera, mic]).map((file) => ({
      ...file,
      transcribe: file.path === "raw/a-cam-01.mp4",
      voices: null,
    }))

    const media = assignRoles([camera, mic], previous)

    expect(by(media, "raw/a-cam-01.mp4").transcribe).toBe(true)
    expect(by(media, "raw/audio.mp3").transcribe).toBe(false)
  })

  test("still assigns a newly added file on re-scan", () => {
    const previous = assignRoles([camera, mic])
    const media = assignRoles([camera, mic, bRoll], previous)

    expect(by(media, "raw/cutaway.mp4").transcribe).toBe(false)
    expect(media).toHaveLength(3)
  })

  test("updates duration when a file is replaced", () => {
    const previous = assignRoles([camera, mic])
    const recut = { ...camera, durationSec: 1200 }
    const media = assignRoles([recut, mic], previous)

    expect(by(media, "raw/a-cam-01.mp4").durationSec).toBe(1200)
  })
})

describe("anchorWords", () => {
  const words = [
    { w: "so", start: 10, end: 10.3, file: "raw/audio.mp3" },
    { w: "then", start: 10.4, end: 10.8, file: "raw/audio.mp3" },
  ]

  /**
   * The sign convention, stated once: a mic that started 8.2s before the camera
   * reads -8.2, because its own 10.0s mark is the camera's 1.8s. Getting this
   * backwards shifts every b-roll cue by twice the offset, in the wrong
   * direction, with nothing to notice it by.
   */
  test("a mic that rolled first takes a negative offset", () => {
    const anchored = anchorWords(words, {
      path: "raw/audio.mp3",
      offsetSec: -8.2,
      voices: "raw/a-cam-01.mp4",
    })

    expect(anchored[0].start).toBeCloseTo(1.8, 6)
    expect(anchored[1].end).toBeCloseTo(2.6, 6)
  })

  test("re-tags words with the clip the editor actually scrubs", () => {
    const anchored = anchorWords(words, {
      path: "raw/audio.mp3",
      offsetSec: -8.2,
      voices: "raw/a-cam-01.mp4",
    })

    // A scene sourced from the mic file would otherwise tell the editor to
    // scrub an mp3, which isn't on their timeline.
    expect(anchored.every((word) => word.file === "raw/a-cam-01.mp4")).toBe(
      true
    )
  })

  test("a camera that rolled first takes a positive offset", () => {
    const anchored = anchorWords(words, {
      path: "raw/audio.mp3",
      offsetSec: 3.5,
      voices: "raw/a-cam-01.mp4",
    })

    expect(anchored[0].start).toBeCloseTo(13.5, 6)
  })

  test("leaves a self-anchored file untouched", () => {
    const anchored = anchorWords(words, {
      path: "raw/audio.mp3",
      offsetSec: 0,
      voices: null,
    })

    expect(anchored).toEqual(words)
  })

  test("preserves the gaps between words", () => {
    const anchored = anchorWords(words, {
      path: "raw/audio.mp3",
      offsetSec: -8.2,
      voices: "raw/a-cam-01.mp4",
    })

    // A constant shift, so segmentation splits in exactly the same places.
    expect(anchored[1].start - anchored[0].end).toBeCloseTo(
      words[1].start - words[0].end,
      6
    )
  })
})
