/**
 * Where extracted audio lives between steps 2 and 3.
 *
 * Two steps need to agree on the path without passing it through workflow
 * state, so it's derived from the project id and the media file's relative
 * path. Deriving rather than storing also means a re-run of step 3 alone —
 * which is the whole point of Studio's time travel (idea.md §9) — still finds
 * the audio extracted by an earlier run.
 */

import { createHash } from "node:crypto"

import { tmpDir } from "./paths"

/**
 * A hash rather than the path itself: media paths contain slashes and spaces,
 * and `raw/a-cam-01.mp4` and `b-roll/a-cam-01.mp4` must not collide.
 */
export function audioPathFor(projectId: string, mediaPath: string) {
  const digest = createHash("sha1").update(mediaPath).digest("hex").slice(0, 12)
  return tmpDir("audio", projectId, `${digest}.mp3`)
}
