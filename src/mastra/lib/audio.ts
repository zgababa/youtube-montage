/**
 * Where extracted audio lives between extraction and transcription.
 *
 * The two steps need to agree on the path without passing it through any
 * shared state, so it's derived from the project id and the media file's
 * relative path. Deriving rather than storing also means re-running
 * transcription alone still finds the audio a previous run already
 * extracted, cache-and-skip rather than a re-extract (idea.md §9).
 */

import { createHash } from "node:crypto"
import fs from "node:fs/promises"

import { tmpDir } from "./paths"

/**
 * A hash rather than the path itself: media paths contain slashes and spaces,
 * and `raw/a-cam-01.mp4` and `b-roll/a-cam-01.mp4` must not collide.
 */
export function audioPathFor(projectId: string, mediaPath: string) {
  const digest = createHash("sha1").update(mediaPath).digest("hex").slice(0, 12)
  return tmpDir("audio", projectId, `${digest}.mp3`)
}

/**
 * Whether an earlier run's extraction can be reused.
 *
 * Extraction is I/O bound on the *source*, not the output: pulling 3.8 MB of
 * audio out of an 11 GB camera file takes three minutes at 1% CPU, because
 * ffmpeg still has to read the whole 11 GB. Re-running the pipeline — which is
 * the normal way to iterate on prompts (idea.md §9) — would otherwise pay that
 * again for every file, every time.
 *
 * Modification time rather than a hash, for the same reason: hashing the source
 * to decide whether to read the source saves nothing.
 */
export async function audioIsFresh(
  sourcePath: string,
  audioPath: string
): Promise<boolean> {
  const [source, audio] = await Promise.all([
    fs.stat(sourcePath).catch(() => null),
    fs.stat(audioPath).catch(() => null),
  ])

  // No source is not this function's problem — let ffmpeg produce the error.
  if (!source || !audio) return false
  // An empty file is a previous run that died mid-extract.
  if (audio.size === 0) return false

  return audio.mtimeMs >= source.mtimeMs
}
