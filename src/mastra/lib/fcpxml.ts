/**
 * The cut timeline, as FCPXML.
 *
 * The spine is one sequential `<asset-clip>` per kept run, audio embedded
 * because nothing here cuts it separately (idea.md's own "not built" list,
 * and this fork's `docs/adr/0001-…`). Exported scenes are composited on top:
 * each lands as a connected clip on `lane="1"`, nested inside the spine clip
 * for the run its `scriptStart` falls in.
 *
 * The nesting relies on one thing lining up: a spine clip's `start` attribute
 * is the run's own raw source timecode (`run.sourceStart`), and a connected
 * clip's `offset` is read in that same coordinate system — confirmed against
 * a real picture-in-picture export (`pip.fcpxml` in andrewarrow/cutlass): a
 * parent clip with `start="27200/3000s"` carried a connected clip at
 * `offset="35900/3000s"`, a value *inside* the parent's own source range, not
 * relative to 0 or to the parent's sequence `offset`. Since `scene.scriptStart`
 * (`scenarios.ts`) is already a raw source timecode in that exact domain
 * (`segments.ts` — segments "keep their original indices and timings"), no
 * translation is needed: the scene's own `scriptStart`, snapped to the frame
 * grid, *is* the connected clip's `offset`.
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

/**
 * XML escaping shared with `titles.ts`'s title-screen template.
 *
 * Escapes the superset an XML attribute value and an HTML element's text
 * content both need — attributes require `"`, text content doesn't, but
 * escaping it there is harmless, and one function used in both places is
 * simpler than two escapers that could drift on which characters they cover.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function fileUrl(projectPath: string, relative: string): string {
  const absolute = toAbsolute(projectPath, relative)
  // FCPXML wants a URL, not a filesystem path — spaces and the rest of a
  // filename's non-ASCII characters have to be percent-encoded or Resolve's
  // importer fails to resolve the media at all.
  return `file://${absolute.split(path.sep).map(encodeURIComponent).join("/")}`
}

/** What `overlayStep` has for a scene once it's exported — enough to place it. */
export interface OverlayScene {
  id: string
  sourceFile: string
  scriptStart: number
  durationSec: number
  /** Project-relative, as stored in `scene.exportPath`. */
  exportPath: string
}

/**
 * One piece of a scene overlay, nested inside one run's spine clip.
 *
 * A scene rarely fits inside a single run: `buildKeptRuns` starts a new run
 * at every natural pause of 0.6s+ between two kept segments that's longer
 * than `maxSilenceSec` (default 0.3s) — content the cleanup pass never cut,
 * just a breath the exported timeline trims. Runs are always spine-adjacent
 * regardless of why one ends (a real cut and a trimmed pause both leave zero
 * gap between consecutive runs — `buildFcpxml`'s offsets are cumulative), so
 * a scene that spans a run boundary keeps playing without a gap on the
 * output timeline. FCPXML just can't say that in one element: a connected
 * clip is nested inside exactly one spine parent, so a scene that crosses N
 * run boundaries becomes N+1 fragments, each played from wherever the
 * previous one left off in the overlay's *own* clip (`sourceOffset`).
 */
interface OverlayFragment {
  sceneId: string
  runIndex: number
  /** Where this fragment starts, in the run's own source-timecode domain. */
  runOffset: number
  /** How far into the overlay's own `.mov` this fragment starts. */
  sourceOffset: number
  durationSec: number
}

/**
 * Walks each scene forward from the run its `scriptStart` falls inside,
 * across as many consecutive runs as its duration needs.
 *
 * A scene with no matching first run is one whose window landed on content
 * that ended up cut — shouldn't happen since scenes are placed against kept
 * segments (`scenarios.ts`), but a scene the cut timeline can't place at all
 * is exactly the kind of silently-wrong result this codebase refuses rather
 * than guesses at (see `assertSingleTranscriptionSource`). Reported to the
 * caller instead, so the workflow logs it and the run continues.
 *
 * Running out of runs before the scene's duration is spent — the kept
 * footage simply ends first — truncates the last fragment rather than
 * dropping the scene: an overlay cut a little short is a smaller problem
 * than one silently missing.
 */
export function placeOverlays(
  runs: TimelineRun[],
  scenes: OverlayScene[]
): { placed: OverlayFragment[]; skipped: string[] } {
  const placed: OverlayFragment[] = []
  const skipped: string[] = []

  for (const scene of scenes) {
    const startIndex = runs.findIndex(
      (run) =>
        run.file === scene.sourceFile &&
        scene.scriptStart >= run.sourceStart &&
        scene.scriptStart < run.sourceEnd
    )

    if (startIndex === -1) {
      skipped.push(scene.id)
      continue
    }

    let remaining = scene.durationSec
    let sourceOffset = 0

    for (let runIndex = startIndex; runIndex < runs.length && remaining > 0; runIndex++) {
      const run = runs[runIndex]
      const runOffset = runIndex === startIndex ? scene.scriptStart : run.sourceStart
      const available = run.sourceEnd - runOffset
      if (available <= 0) continue

      const durationSec = Math.min(remaining, available)
      placed.push({
        sceneId: scene.id,
        runIndex,
        runOffset,
        sourceOffset,
        durationSec,
      })

      remaining -= durationSec
      sourceOffset += durationSec
    }
  }

  return { placed, skipped }
}

/**
 * The clip scene overlays sit on — see `white-backing.ts`.
 *
 * Optional, and deliberately a separate layer rather than baked into the
 * scene's own export: a scene stays a transparent overlay either way, and
 * whether it reads as a full-frame cutaway is decided here, at composite
 * time, by whether this is passed. Dropping it (or deleting the resulting
 * lane by hand in the NLE afterward) gets the plain overlay back with
 * nothing to regenerate.
 */
export interface WhiteBacking {
  /** Project-relative, as returned by `ensureWhiteBacking`. */
  exportPath: string
  /** The clip's own full length — every fragment takes a shorter slice of it. */
  durationSec: number
}

/**
 * Builds the FCPXML document for a cut timeline: one `<asset>` per distinct
 * source file, one `<asset-clip>` per kept run, in order — plus, for each
 * scene `placeOverlays` can place, a nested `<asset-clip>` and its own
 * `<asset>`, on `lane="2"` if backed by `whiteBacking` (itself `lane="1"`,
 * directly beneath) or `lane="1"` alone if not.
 */
export function buildFcpxml(
  project: StoredProject,
  runs: TimelineRun[],
  scenes: OverlayScene[] = [],
  whiteBacking: WhiteBacking | null = null
): string {
  const fps = project.fps
  const byPath = new Map(project.media.map((file) => [file.path, file]))

  const files = [...new Set(runs.map((run) => run.file))]
  const assetIds = new Map(
    files.map((file, index) => [file, `asset-${index + 1}`])
  )

  const { placed } = placeOverlays(runs, scenes)
  const overlaysByRun = new Map<number, OverlayFragment[]>()
  for (const fragment of placed) {
    const forRun = overlaysByRun.get(fragment.runIndex) ?? []
    forRun.push(fragment)
    overlaysByRun.set(fragment.runIndex, forRun)
  }

  const placedSceneIds = new Set(placed.map((fragment) => fragment.sceneId))
  const placedScenes = scenes.filter((scene) => placedSceneIds.has(scene.id))
  const overlayAssetIds = new Map(
    placedScenes.map((scene) => [scene.id, `scene-asset-${scene.id}`])
  )

  // Only worth an <asset> if there's at least one fragment to back.
  const backing = placed.length > 0 ? whiteBacking : null
  const sceneLane = backing ? 2 : 1

  const resources = [
    ...files.map((file) =>
      assetXml(file, mediaFor(byPath, file), project, assetIds.get(file)!)
    ),
    ...placedScenes.map((scene) =>
      sceneAssetXml(scene, project, overlayAssetIds.get(scene.id)!)
    ),
    ...(backing ? [whiteBackingAssetXml(backing, project)] : []),
  ].join("\n    ")

  // Fragments of the same scene are numbered in placement order — the second
  // piece of a scene that crossed a run boundary reads "scene_04 (2)" rather
  // than repeating "scene_04" and looking like a duplicate.
  const partNumber = new Map<string, number>()

  // Counted in frames, not seconds: each clip's offset is the exact sum of the
  // durations before it, so the spine has no gap or overlap however long it
  // gets. Summing floats and rounding each offset separately drifts by a frame.
  let offsetFrames = 0
  const clips = runs
    .map((run, index) => {
      const durationFrames = toFrames(run.sourceEnd - run.sourceStart, fps)
      const children = (overlaysByRun.get(index) ?? [])
        .flatMap((fragment) => {
          const part = (partNumber.get(fragment.sceneId) ?? 0) + 1
          partNumber.set(fragment.sceneId, part)
          const name = part === 1 ? fragment.sceneId : `${fragment.sceneId} (${part})`
          const offset = secondsToRational(fragment.runOffset, fps)
          const duration = secondsToRational(fragment.durationSec, fps)

          const scene = connectedClipXml({
            ref: overlayAssetIds.get(fragment.sceneId)!,
            name,
            lane: sceneLane,
            offset,
            start: secondsToRational(fragment.sourceOffset, fps),
            duration,
          })

          if (!backing) return [scene]

          // Same offset and duration as the scene it backs — always starts
          // at 0s of its own clip, since any slice of a solid colour looks
          // the same as any other.
          const white = connectedClipXml({
            ref: WHITE_BACKING_ASSET_ID,
            name: `${name} backing`,
            lane: 1,
            offset,
            start: "0s",
            duration,
          })
          return [white, scene]
        })
        .join("\n              ")
      const clip = clipXml({
        ref: assetIds.get(run.file)!,
        name: path.basename(run.file),
        offset: framesToRational(offsetFrames, fps),
        start: secondsToRational(run.sourceStart, fps),
        duration: framesToRational(durationFrames, fps),
        children: children || undefined,
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

/**
 * The `<asset>` for one exported scene overlay: video-only, no audio track —
 * the run it's nested in keeps supplying the audio underneath it. Transparent
 * (`scene-agent.ts`), same as it's always been: whether it reads as a
 * full-frame cutaway is decided by `buildFcpxml`'s `whiteBacking`, not baked
 * into the export. One frame's worth of `format-1` because scenes are always
 * exported at `project.fps` (`export.ts`).
 */
function sceneAssetXml(
  overlay: OverlayScene,
  project: StoredProject,
  id: string
): string {
  const name = esc(`${overlay.id} overlay`)
  const src = esc(fileUrl(project.path, overlay.exportPath))
  const duration = secondsToRational(overlay.durationSec, project.fps)

  return (
    `<asset id="${id}" name="${name}" ` +
    `hasAudio="0" hasVideo="1" ` +
    `format="format-1" duration="${duration}" start="0s">\n` +
    `      <media-rep kind="original-media" src="${src}"/>\n` +
    `    </asset>`
  )
}

/** The `<asset>` id `buildFcpxml` gives the (at most one) white backing clip. */
const WHITE_BACKING_ASSET_ID = "asset-white-backing"

/**
 * The `<asset>` for the white backing clip — opaque, video-only, no audio.
 * `duration` is whatever `ensureWhiteBacking` actually encoded; every fragment
 * that uses it takes its own shorter slice starting at `0s` (`buildFcpxml`).
 */
function whiteBackingAssetXml(
  backing: WhiteBacking,
  project: StoredProject
): string {
  const src = esc(fileUrl(project.path, backing.exportPath))

  return (
    `<asset id="${WHITE_BACKING_ASSET_ID}" name="White backing" ` +
    `hasAudio="0" hasVideo="1" ` +
    `format="format-1" duration="${secondsToRational(backing.durationSec, project.fps)}" start="0s">\n` +
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
  /** Connected clips (`lane="1"` and up), already rendered as XML. */
  children?: string
}): string {
  const attrs =
    `name="${esc(clip.name)}" ref="${clip.ref}" ` +
    `offset="${clip.offset}" start="${clip.start}" duration="${clip.duration}"`

  if (!clip.children) return `<asset-clip ${attrs}/>`

  return (
    `<asset-clip ${attrs}>\n` +
    `              ${clip.children}\n` +
    `            </asset-clip>`
  )
}

/**
 * One fragment of a scene overlay (or its white backing), connected above the
 * run it was placed in.
 *
 * `start` is the fragment's in-point *within its own clip* — for a scene,
 * `0s` on its first fragment and however many seconds the earlier fragments
 * already played for every one after (`placeOverlays`' `sourceOffset`);
 * continuing from the right point is what makes a scene that crosses a run
 * boundary read as one continuous overlay instead of restarting partway
 * through. For the backing clip it's always `0s` — see `buildFcpxml`.
 */
function connectedClipXml(overlay: {
  ref: string
  name: string
  lane: number
  offset: string
  start: string
  duration: string
}): string {
  return (
    `<asset-clip name="${esc(overlay.name)}" ref="${overlay.ref}" lane="${overlay.lane}" ` +
    `offset="${overlay.offset}" start="${overlay.start}" duration="${overlay.duration}"/>`
  )
}
