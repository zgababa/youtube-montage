/**
 * The plain white clip scene overlays sit on in `timeline.fcpxml`.
 *
 * Scenes stay transparent overlays (`scene-agent.ts`, `render.ts`) rather
 * than baking an opaque background into every export — that keeps a scene's
 * `.mov` reusable both ways: composited straight over the footage as a true
 * overlay, or backed by this clip to read as a full-frame cutaway. Which one
 * happens is a choice made in `fcpxml.ts` at composite time, not something
 * that has to be decided again by regenerating the scene.
 *
 * One clip, sliced to whatever length each fragment needs, rather than one
 * per fragment or per scene: a solid colour looks identical at any offset
 * into itself, so every fragment can start its slice at `0s` of the same
 * file and nothing is lost by sharing it.
 */

import { encodeSolidColor, probe } from "./ffmpeg"
import { toRelative, whiteBackingPath } from "./paths"

/**
 * Floor on the generated clip's length.
 *
 * Keeps a project with only very short scenes from ending up with a
 * backing clip so short a later, longer scene would need a full re-encode —
 * a few seconds of ProRes 422 costs nothing to keep around.
 */
const MIN_DURATION_SEC = 10

export interface WhiteBackingFile {
  /** Project-relative, ready for `scene.exportPath`'s own convention. */
  exportPath: string
  /** The clip's own actual length — may be longer than requested (`MIN_DURATION_SEC`). */
  durationSec: number
}

/**
 * Ensures a white backing clip at least `durationSec` long exists for this
 * project, encoding (or re-encoding, if the existing one is too short) as
 * needed.
 */
export async function ensureWhiteBacking(
  projectPath: string,
  fps: number,
  durationSec: number
): Promise<WhiteBackingFile> {
  const absolute = whiteBackingPath(projectPath)
  const needed = Math.max(durationSec, MIN_DURATION_SEC)

  const existing = await existingDuration(absolute)
  if (existing !== null && existing >= needed - 1 / fps) {
    return { exportPath: toRelative(projectPath, absolute), durationSec: existing }
  }

  await encodeSolidColor(absolute, {
    width: 1920,
    height: 1080,
    fps,
    durationSec: needed,
    color: "white",
  })

  return { exportPath: toRelative(projectPath, absolute), durationSec: needed }
}

/** `null` when the file doesn't exist yet — the common case, on a project's first composite. */
async function existingDuration(absolutePath: string): Promise<number | null> {
  try {
    return (await probe(absolutePath)).durationSec
  } catch {
    return null
  }
}
