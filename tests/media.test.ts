import { describe, expect, test } from "bun:test"

import {
  anchorWords,
  assignRoles,
  checkMediaRoles,
  compareForScript,
  isNumbered,
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

/**
 * The folder that motivated this: two numbered parts of a talk, a screen
 * recording of the second one (same duration to within half a second), and an
 * unrelated audio file. Nothing pairs — three clips carry sound — so every one
 * of them was transcribed, and the script contained the second part twice plus
 * thirteen minutes that belonged to nothing.
 */
describe("numbered files are the script", () => {
  const part1: ProbedFile = {
    path: "01.MP4",
    durationSec: 891.4,
    hasAudio: true,
    hasVideo: true,
  }
  const part2: ProbedFile = {
    path: "02.MP4",
    durationSec: 2569.4,
    hasAudio: true,
    hasVideo: true,
  }
  const restage: ProbedFile = {
    path: "Helium.mp4",
    durationSec: 2569.8,
    hasAudio: true,
    hasVideo: true,
  }
  const unrelated: ProbedFile = {
    path: "before-demo-thumbs.mp3",
    durationSec: 831.1,
    hasAudio: true,
    hasVideo: false,
  }

  test("transcribes the numbered files and nothing else", () => {
    const media = assignRoles([part1, part2, restage, unrelated])
    const sources = media.filter((file) => file.transcribe)

    expect(sources.map((file) => file.path)).toEqual(["01.MP4", "02.MP4"])
  })

  test("leaves the excluded files as footage, not as anchors", () => {
    const media = assignRoles([part1, part2, restage, unrelated])

    expect(by(media, "Helium.mp4").voices).toBeNull()
    expect(by(media, "before-demo-thumbs.mp3").voices).toBeNull()
  })

  /**
   * Unconditional, this rule would transcribe nothing here and the run would
   * die at step 2 with no source — worse than the doubled script it prevents.
   */
  test("does nothing to a folder that numbers nothing", () => {
    const media = assignRoles([camera, screen])

    expect(media.filter((file) => file.transcribe)).toHaveLength(2)
  })

  test("does nothing when every file is numbered", () => {
    const media = assignRoles([part1, part2])

    expect(media.filter((file) => file.transcribe)).toHaveLength(2)
  })

  /**
   * The pairing is the narrower signal and runs first. A numbered camera clip
   * with a separate mic still transcribes the mic, because "which file has the
   * good audio" is a different question from "which files are the script".
   */
  test("does not override the mic pairing", () => {
    const media = assignRoles([part1, mic])

    expect(by(media, "raw/audio.mp3").transcribe).toBe(true)
    expect(by(media, "raw/audio.mp3").voices).toBe("01.MP4")
    expect(by(media, "01.MP4").transcribe).toBe(false)
  })

  test("a file the user switched back on stays on", () => {
    const previous = assignRoles([part1, part2, restage]).map((file) =>
      file.path === "Helium.mp4" ? { ...file, transcribe: true } : file
    )

    const media = assignRoles([part1, part2, restage], previous)

    expect(by(media, "Helium.mp4").transcribe).toBe(true)
  })
})

describe("isNumbered", () => {
  test("accepts the shapes people actually name parts", () => {
    for (const name of [
      "01.MP4",
      "1.mp4",
      "02 - demo.mov",
      "03-outro.mp4",
      "raw/04_intro.mp4",
      "12.mp4",
    ]) {
      expect(isNumbered(name)).toBe(true)
    }
  })

  test("a date-named export is not part 2026 of the script", () => {
    expect(isNumbered("2026-08-03 shoot.mp4")).toBe(false)
  })

  test("a number elsewhere in the name doesn't count", () => {
    // The convention is a prefix. `a-cam-01` is a camera label, not a position.
    expect(isNumbered("raw/a-cam-01.mp4")).toBe(false)
    expect(isNumbered("Helium.mp4")).toBe(false)
  })
})

describe("compareForScript", () => {
  const order = (paths: string[]) => [...paths].sort(compareForScript)

  test("honours a zero-padded prefix", () => {
    expect(
      order(["raw/03 - outro.mp4", "raw/01 - intro.mp4", "raw/02 - demo.mp4"])
    ).toEqual(["raw/01 - intro.mp4", "raw/02 - demo.mp4", "raw/03 - outro.mp4"])
  })

  /**
   * The classic way a numbered sequence goes wrong on its tenth entry: plain
   * string comparison puts "10" before "2", so the script silently reorders
   * itself only once the shoot gets long enough.
   */
  test("sorts unpadded numbers numerically", () => {
    expect(
      order(["raw/10 - ten.mp4", "raw/2 - two.mp4", "raw/9 - nine.mp4"])
    ).toEqual(["raw/2 - two.mp4", "raw/9 - nine.mp4", "raw/10 - ten.mp4"])
  })

  /**
   * Sorting whole paths lets the folder outrank the number the user typed —
   * "raw/02" would lead "screen/01" purely because r < s.
   */
  test("the number wins over the folder it's in", () => {
    expect(order(["screen/02 - demo.mp4", "raw/01 - intro.mp4"])).toEqual([
      "raw/01 - intro.mp4",
      "screen/02 - demo.mp4",
    ])
  })

  test("mixed separators after the number still order", () => {
    expect(order(["raw/02-demo.mp4", "raw/01 - intro.mp4"])).toEqual([
      "raw/01 - intro.mp4",
      "raw/02-demo.mp4",
    ])
  })

  test("same name in two folders is ordered, not tied", () => {
    const sorted = order(["b/take.mp4", "a/take.mp4"])

    expect(sorted).toEqual(["a/take.mp4", "b/take.mp4"])
    // Deterministic either way round — an unstable tie would reshuffle the
    // script between runs for no visible reason.
    expect(order(["a/take.mp4", "b/take.mp4"])).toEqual(sorted)
  })

  test("unnumbered files fall back to name order", () => {
    expect(order(["raw/interview.mp4", "raw/demo.mp4"])).toEqual([
      "raw/demo.mp4",
      "raw/interview.mp4",
    ])
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

function file(over: Partial<MediaFile> & { path: string }): MediaFile {
  return {
    durationSec: 60,
    hasAudio: true,
    hasVideo: true,
    transcribe: true,
    offsetSec: 0,
    voices: null,
    ...over,
  }
}

describe("checkMediaRoles", () => {
  test("accepts a mic voicing the camera it was recorded for", () => {
    const media = [
      file({ path: "raw/a-cam-01.mp4" }),
      file({ path: "raw/audio.mp3", hasVideo: false, voices: "raw/a-cam-01.mp4" }),
    ]

    expect(checkMediaRoles(media)).toBeNull()
  })

  test("rejects a voices pointing at a file that isn't in the project", () => {
    const media = [file({ path: "raw/audio.mp3", voices: "raw/gone.mp4" })]

    expect(checkMediaRoles(media)).toMatch("isn't in this project")
  })

  test("rejects a file voicing itself", () => {
    const media = [file({ path: "raw/audio.mp3", voices: "raw/audio.mp3" })]

    expect(checkMediaRoles(media)).toMatch("can't voice itself")
  })

  test("rejects a chain of voices rather than a single anchor", () => {
    const media = [
      file({ path: "raw/a-cam-01.mp4" }),
      file({ path: "raw/audio.mp3", voices: "raw/a-cam-01.mp4" }),
      file({ path: "raw/lav.mp3", voices: "raw/audio.mp3" }),
    ]

    expect(checkMediaRoles(media)).toMatch("voices something else in turn")
  })
})
