import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { audioIsFresh, audioPathFor } from "../src/mastra/lib/audio"

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "audio-test-"))

afterAll(async () => {
  await fs.rm(scratch, { recursive: true, force: true })
})

async function write(name: string, content = "x", mtimeMs?: number) {
  const file = path.join(scratch, name)
  await fs.writeFile(file, content)
  if (mtimeMs !== undefined) {
    const when = new Date(mtimeMs)
    await fs.utimes(file, when, when)
  }
  return file
}

describe("audioPathFor", () => {
  test("is stable across calls", () => {
    // Steps 2 and 3 agree on the location by deriving it, not by passing it
    // through workflow state — so a re-run of step 3 alone still finds it.
    expect(audioPathFor("proj", "raw/a.mp4")).toBe(
      audioPathFor("proj", "raw/a.mp4")
    )
  })

  test("the same basename in two folders doesn't collide", () => {
    expect(audioPathFor("proj", "raw/a.mp4")).not.toBe(
      audioPathFor("proj", "b-roll/a.mp4")
    )
  })

  test("two projects don't share an extraction", () => {
    expect(audioPathFor("one", "raw/a.mp4")).not.toBe(
      audioPathFor("two", "raw/a.mp4")
    )
  })
})

describe("audioIsFresh", () => {
  /**
   * Extraction is I/O bound on the source: 3 minutes to pull 3.8 MB out of an
   * 11 GB camera file, because ffmpeg reads all 11 GB either way. Re-running
   * the pipeline is the normal way to iterate, so paying that again per file
   * per run is the difference between a re-run costing seconds and minutes.
   */
  test("reuses an extraction newer than its source", async () => {
    const source = await write("source.mp4", "video", 1000)
    const audio = await write("audio.mp3", "sound", 2000)

    expect(await audioIsFresh(source, audio)).toBe(true)
  })

  test("re-extracts when the source has been re-exported since", async () => {
    const source = await write("newer-source.mp4", "video", 5000)
    const audio = await write("older-audio.mp3", "sound", 3000)

    expect(await audioIsFresh(source, audio)).toBe(false)
  })

  test("same timestamp counts as fresh", async () => {
    const source = await write("same-source.mp4", "video", 4000)
    const audio = await write("same-audio.mp3", "sound", 4000)

    expect(await audioIsFresh(source, audio)).toBe(true)
  })

  test("a zero-byte file is a died-mid-extract, not a cache hit", async () => {
    // The file exists and its mtime is newer, so every other check passes.
    // Reusing it would send silence to the transcriber and return no words.
    const source = await write("partial-source.mp4", "video", 1000)
    const audio = await write("partial-audio.mp3", "", 2000)

    expect(await audioIsFresh(source, audio)).toBe(false)
  })

  test("no extraction yet", async () => {
    const source = await write("lonely.mp4", "video")

    expect(await audioIsFresh(source, path.join(scratch, "nope.mp3"))).toBe(
      false
    )
  })

  test("missing source is left for ffmpeg to report", async () => {
    const audio = await write("orphan.mp3", "sound")

    expect(await audioIsFresh(path.join(scratch, "gone.mp4"), audio)).toBe(
      false
    )
  })
})
