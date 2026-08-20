/**
 * The cut timeline, as FCPXML.
 *
 * v1 only ever writes the spine — one sequential `<asset-clip>` per kept run,
 * audio embedded because nothing here cuts it separately (idea.md's own
 * "not built" list, and this fork's `docs/adr/0001-…`). Scenes land in a
 * connected clip on `lane="1"` in a later iteration; this file is written so
 * that extension only adds to `buildFcpxml`, not a second generator next to
 * it.
 *
 * **Version and rational format are researched, not guessed** (see
 * `docs/adr/0001-export-fcpxml-plutot-que-edl.md`). DaVinci Resolve's FCPXML
 * importer has always trailed the Final Cut Pro spec it's named after, and
 * multiple independent compatibility write-ups converge on the same
 * conclusion for Resolve 17 through 19 (no changelog entry for 21 says
 * otherwise, and Resolve's NLE-interchange layer hasn't changed shape across
 * that range): `version="1.9"` is what parses most reliably, `1.10` also
 * works from Resolve 18 on, and `1.11`+ has documented import failures. 1.9
 * is the version this file writes — which also fixes the shape of `<asset>`:
 * from 1.8 on the source URL is a `<media-rep>` child, not an `src` attribute.
 *
 * Every timing value FCPXML cares about — `frameDuration`, `duration`,
 * `offset`, `start` — is a rational number of seconds as `"num/den" + "s"`,
 * never a decimal. NTSC rates (23.976, 29.97, 59.94 fps) are not exactly
 * representable in decimal seconds; a frame is exactly 1001/24000s, not
 * 0.041708333...s. Rounding that to a float and back is how a cut list drifts
 * out of sync with picture over a long timeline — the whole reason this
 * module deals in fractions at all.
 */

import path from "node:path"

import { toAbsolute } from "./paths"
import type { TimelineRun } from "./timeline"
import type { MediaFile, StoredProject } from "../schemas"

/**
 * Exact frame-duration fractions for the fps values this app actually
 * produces or imports (idea.md's supported rates). Keyed by the rounded fps a
 * project stores, since `project.fps` for an NTSC rate is conventionally
 * written as the decimal (`29.97`), not the fraction.
 */
const FRAME_DURATIONS: Record<number, { num: number; den: number }> = {
  23.976: { num: 1001, den: 24000 },
  24: { num: 1, den: 24 },
  25: { num: 1, den: 25 },
  29.97: { num: 1001, den: 30000 },
  30: { num: 1, den: 30 },
  50: { num: 1, den: 50 },
  59.94: { num: 1001, den: 60000 },
  60: { num: 1, den: 60 },
}

/** A frame duration for any fps, exact where the table has it, `1/round(fps)` otherwise. */
function frameDuration(fps: number): { num: number; den: number } {
  return FRAME_DURATIONS[fps] ?? { num: 1, den: Math.round(fps) }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** Seconds on the fps's frame grid — the unit every value below is counted in. */
function toFrames(seconds: number, fps: number): number {
  const { num, den } = frameDuration(fps)
  return Math.round((seconds * den) / num)
}

/**
 * A whole number of frames as an FCPXML rational string.
 *
 * Everything the spine writes goes through here, so every value shares a
 * denominator with `frameDuration` — a timeline built from values that don't
 * is exactly the kind of file Resolve's importer has been reported to mis-time.
 */
function framesToRational(frames: number, fps: number): string {
  if (frames === 0) return "0s"

  const { num, den } = frameDuration(fps)
  const numerator = frames * num
  const divisor = gcd(numerator, den)
  return `${numerator / divisor}/${den / divisor}s`
}

/**
 * Seconds as an FCPXML rational string, snapped to the fps's frame grid.
 *
 * Only for values that stand alone (an asset's own duration). Anything that
 * has to add up along the spine is accumulated in frames instead — see
 * `buildFcpxml` — because `round(a + b)` and `round(a) + round(b)` differ by a
 * frame often enough to open a gap in a long timeline.
 */
export function secondsToRational(seconds: number, fps: number): string {
  return framesToRational(toFrames(seconds, fps), fps)
}

/** XML attribute values only need `&`, `<`, `"` escaped — FCPXML has no other special chars in play here. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
}

function fileUrl(projectPath: string, relative: string): string {
  const absolute = toAbsolute(projectPath, relative)
  // FCPXML wants a URL, not a filesystem path — spaces and the rest of a
  // filename's non-ASCII characters have to be percent-encoded or Resolve's
  // importer fails to resolve the media at all.
  return `file://${absolute.split(path.sep).map(encodeURIComponent).join("/")}`
}

/**
 * Builds the FCPXML document for a cut timeline: one `<asset>` per distinct
 * source file, one `<asset-clip>` per kept run, in order.
 */
export function buildFcpxml(
  project: StoredProject,
  runs: TimelineRun[]
): string {
  const fps = project.fps
  const byPath = new Map(project.media.map((file) => [file.path, file]))

  const files = [...new Set(runs.map((run) => run.file))]
  const assetIds = new Map(
    files.map((file, index) => [file, `asset-${index + 1}`])
  )

  const resources = files
    .map((file) =>
      assetXml(file, mediaFor(byPath, file), project, assetIds.get(file)!)
    )
    .join("\n    ")

  // Counted in frames, not seconds: each clip's offset is the exact sum of the
  // durations before it, so the spine has no gap or overlap however long it
  // gets. Summing floats and rounding each offset separately drifts by a frame.
  let offsetFrames = 0
  const clips = runs
    .map((run) => {
      const durationFrames = toFrames(run.sourceEnd - run.sourceStart, fps)
      const clip = clipXml({
        ref: assetIds.get(run.file)!,
        name: path.basename(run.file),
        offset: framesToRational(offsetFrames, fps),
        start: secondsToRational(run.sourceStart, fps),
        duration: framesToRational(durationFrames, fps),
      })
      offsetFrames += durationFrames
      return clip
    })
    .join("\n            ")

  const totalDuration = framesToRational(offsetFrames, fps)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE fcpxml>",
    '<fcpxml version="1.9">',
    "  <resources>",
    `    <format id="format-1" frameDuration="${framesToRational(1, fps)}"/>`,
    `    ${resources}`,
    "  </resources>",
    "  <library>",
    '    <event name="Timeline">',
    `      <project name="${esc(project.name)}">`,
    `        <sequence format="format-1" duration="${totalDuration}" tcStart="0s">`,
    "          <spine>",
    `            ${clips}`,
    "          </spine>",
    "        </sequence>",
    "      </project>",
    "    </event>",
    "  </library>",
    "</fcpxml>",
    "",
  ].join("\n")
}

/**
 * The `project.media` entry a run's file came from.
 *
 * Missing is a hard error rather than a default. Guessing `hasAudio` and a
 * zero duration produces an `<asset>` Resolve imports without complaint and
 * whose media it then can't relink — the silently-wrong timeline ADR 0003
 * refuses on the multi-camera side of this same module.
 */
function mediaFor(byPath: Map<string, MediaFile>, file: string): MediaFile {
  const media = byPath.get(file)
  if (!media) {
    throw new Error(
      `The timeline references ${file}, which isn't in project.media — ` +
        "re-scan the project folder before exporting."
    )
  }
  return media
}

function assetXml(
  file: string,
  media: MediaFile,
  project: StoredProject,
  id: string
): string {
  const name = esc(path.basename(file))
  const src = esc(fileUrl(project.path, file))
  const duration = secondsToRational(media.durationSec, project.fps)

  // The source URL is a `<media-rep>` child, not an attribute: `src` on
  // `<asset>` was deprecated in FCPXML 1.8 and is gone from the 1.9 DTD this
  // document declares. Resolve reads the child; an importer given only the
  // old attribute has nothing to relink the media from.
  return (
    `<asset id="${id}" name="${name}" ` +
    `hasAudio="${media.hasAudio ? "1" : "0"}" hasVideo="${media.hasVideo ? "1" : "0"}" ` +
    `format="format-1" duration="${duration}" start="0s">\n` +
    `      <media-rep kind="original-media" src="${src}"/>\n` +
    `    </asset>`
  )
}

function clipXml(clip: {
  ref: string
  name: string
  offset: string
  start: string
  duration: string
}): string {
  return (
    `<asset-clip name="${esc(clip.name)}" ref="${clip.ref}" ` +
    `offset="${clip.offset}" start="${clip.start}" duration="${clip.duration}"/>`
  )
}
