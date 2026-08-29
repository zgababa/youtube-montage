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

import { toAbsolute, sfxPath } from "./paths"
import type { TimelineRun } from "./timeline"
import type { ZoomWindow } from "./zooms"
import { zoomPositionOffset } from "./zooms"
import type { ZoomPosition, TransitionType, SfxType } from "../schemas"
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
  /** Stable editing-plan identity, when this overlay is a planned B-roll scene. */
  planElementId?: string
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
  planElementId?: string
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
): {
  placed: OverlayFragment[]
  skipped: string[]
  truncated: string[]
} {
  const placed: OverlayFragment[] = []
  const skipped: string[] = []
  const truncated: string[] = []

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

    for (
      let runIndex = startIndex;
      runIndex < runs.length && remaining > 0;
      runIndex++
    ) {
      const run = runs[runIndex]
      const runOffset =
        runIndex === startIndex ? scene.scriptStart : run.sourceStart
      const available = run.sourceEnd - runOffset
      if (available <= 0) continue

      const durationSec = Math.min(remaining, available)
      placed.push({
        sceneId: scene.id,
        ...(scene.planElementId ? { planElementId: scene.planElementId } : {}),
        runIndex,
        runOffset,
        sourceOffset,
        durationSec,
      })

      remaining -= durationSec
      sourceOffset += durationSec
    }

    if (remaining > 0) truncated.push(scene.id)
  }

  return { placed, skipped, truncated }
}

export interface ZoomFragment {
  zoomId: string
  runIndex: number
  /** Start in the physical source clock of the parent spine clip. */
  runOffset: number
  durationSec: number
  scale: number
  preset: ZoomWindow["preset"]
  position: ZoomPosition
}

/** Places an approved source window without filling gaps removed by cleanup. */
export function placeZooms(
  runs: TimelineRun[],
  zooms: ZoomWindow[]
): { placed: ZoomFragment[]; skipped: string[] } {
  const placed: ZoomFragment[] = []
  const skipped: string[] = []

  for (const zoom of zooms) {
    const fragments = runs.flatMap((run, runIndex) => {
      if (run.file !== zoom.sourceFile) return []

      const start = Math.max(run.sourceStart, zoom.scriptStart)
      const end = Math.min(run.sourceEnd, zoom.scriptEnd)
      if (end <= start) return []

      return [
        {
          zoomId: zoom.id,
          runIndex,
          runOffset: start,
          durationSec: end - start,
          scale: zoom.scale,
          preset: zoom.preset,
          position: zoom.position,
        },
      ]
    })

    if (fragments.length === 0) {
      skipped.push(zoom.id)
    } else {
      placed.push(...fragments)
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
 * A transition placed between two consecutive spine clips.
 *
 * `runIndex` is the index of the clip *after* the transition — the cut point
 * is between `runIndex - 1` and `runIndex`.
 */
export interface TransitionSpec {
  /** The run index where the transition lands (between this and previous). */
  runIndex: number
  type: TransitionType
  durationSec: number
}

/**
 * An SFX clip placed as a connected audio clip on a negative lane.
 *
 * SFX accompany visual elements (transitions, zooms, scene entrances) and
 * are placed automatically based on the element type, or explicitly via the
 * plan element's `sfxType` field.
 */
export interface SfxClip {
  sfxType: SfxType
  runIndex: number
  /** Start in the physical source clock of the parent spine clip. */
  runOffset: number
  durationSec: number
  /** The plan element id, so composition status can be written back. */
  planElementId?: string
}

const SFX_DURATIONS: Record<SfxType, number> = {
  whoosh: 0.5,
  transition: 0.8,
  pop: 0.3,
  swoosh: 0.6,
  thud: 0.4,
}

/** Default duration for an SFX type when not specified. */
export function defaultSfxDuration(sfxType: SfxType): number {
  return SFX_DURATIONS[sfxType]
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
  whiteBacking: WhiteBacking | null = null,
  zooms: ZoomWindow[] = [],
  transitions: TransitionSpec[] = [],
  sfxClips: SfxClip[] = []
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
  const { placed: placedZooms } = placeZooms(runs, zooms)
  const zoomsByRun = new Map<number, ZoomFragment[]>()
  for (const fragment of placedZooms) {
    const forRun = zoomsByRun.get(fragment.runIndex) ?? []
    forRun.push(fragment)
    zoomsByRun.set(fragment.runIndex, forRun)
  }

  const placedSceneIds = new Set(placed.map((fragment) => fragment.sceneId))
  const placedScenes = scenes.filter((scene) => placedSceneIds.has(scene.id))
  const overlayAssetIds = new Map(
    placedScenes.map((scene) => [scene.id, `scene-asset-${scene.id}`])
  )

  // Group SFX clips by run index for placement as connected audio clips.
  const sfxByRun = new Map<number, SfxClip[]>()
  for (const clip of sfxClips) {
    const forRun = sfxByRun.get(clip.runIndex) ?? []
    forRun.push(clip)
    sfxByRun.set(clip.runIndex, forRun)
  }

  // Only worth an <asset> if there's at least one fragment to back.
  const backing = placed.length > 0 ? whiteBacking : null
  const sceneLane = backing ? 2 : 1

  // Collect unique SFX types used for asset generation.
  const usedSfxTypes = [...new Set(sfxClips.map((s) => s.sfxType))]

  const resources = [
    ...files.map((file) =>
      assetXml(file, mediaFor(byPath, file), project, assetIds.get(file)!)
    ),
    ...placedScenes.map((scene) =>
      sceneAssetXml(scene, project, overlayAssetIds.get(scene.id)!)
    ),
    ...(backing ? [whiteBackingAssetXml(backing, project)] : []),
    ...usedSfxTypes.map((sfxType) => sfxAssetXml(sfxType, project)),
  ].join("\n    ")

  // Fragments of the same scene are numbered in placement order — the second
  // piece of a scene that crossed a run boundary reads "scene_04 (2)" rather
  // than repeating "scene_04" and looking like a duplicate.
  const partNumber = new Map<string, number>()
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]))

  // Counted in frames, not seconds: each clip's offset is the exact sum of the
  // durations before it, so the spine has no gap or overlap however long it
  // gets. Summing floats and rounding each offset separately drifts by a frame.
  let offsetFrames = 0
  const transitionSet = new Map(transitions.map((t) => [t.runIndex, t]))
  const clips = runs
    .flatMap((run, index) => {
      // A run with an approved zoom in it splits into as many source clips
      // as the zoom has edges — `<adjust-transform>` applies to a whole
      // `<asset-clip>`, so the zoomed span can't share a clip with the
      // untransformed footage around it.
      const zoomFragments = zoomsByRun.get(index) ?? []
      const boundaries = [
        run.sourceStart,
        run.sourceEnd,
        ...zoomFragments.flatMap((fragment) => [
          fragment.runOffset,
          fragment.runOffset + fragment.durationSec,
        ]),
      ]
        .filter(
          (value, boundaryIndex, values) =>
            value >= run.sourceStart &&
            value <= run.sourceEnd &&
            values.indexOf(value) === boundaryIndex
        )
        .sort((a, b) => a - b)

      const runClips = boundaries.slice(0, -1).map((sourceStart, partIndex) => {
        const sourceEnd = boundaries[partIndex + 1]
        const zoom = zoomFragments.find(
          (fragment) =>
            fragment.runOffset >= sourceStart && fragment.runOffset < sourceEnd
        )
        const children = [
          ...(overlaysByRun.get(index) ?? [])
            .flatMap((fragment) => {
              const overlapStart = Math.max(fragment.runOffset, sourceStart)
              const overlapEnd = Math.min(
                fragment.runOffset + fragment.durationSec,
                sourceEnd
              )
              if (overlapEnd <= overlapStart) return []

              const part = (partNumber.get(fragment.sceneId) ?? 0) + 1
              partNumber.set(fragment.sceneId, part)
              const planElementId = sceneById.get(fragment.sceneId)?.planElementId
              const identity =
                planElementId && planElementId !== fragment.sceneId
                  ? `${fragment.sceneId} [${planElementId}]`
                  : fragment.sceneId
              const name = part === 1 ? identity : `${identity} (${part})`
              const sourceOffset =
                fragment.sourceOffset + (overlapStart - fragment.runOffset)
              const offset = secondsToRational(overlapStart, fps)
              const duration = secondsToRational(overlapEnd - overlapStart, fps)

              const scene = connectedClipXml({
                ref: overlayAssetIds.get(fragment.sceneId)!,
                name,
                lane: sceneLane,
                offset,
                start: secondsToRational(sourceOffset, fps),
                duration,
              })

              if (!backing) return [scene]

              const white = connectedClipXml({
                ref: WHITE_BACKING_ASSET_ID,
                name: `${name} backing`,
                lane: 1,
                offset,
                start: "0s",
                duration,
              })
              return [white, scene]
            }),
          ...(sfxByRun.get(index) ?? [])
            .filter(
              (sfx) => sfx.runOffset >= sourceStart && sfx.runOffset < sourceEnd
            )
            .map((sfx) =>
              connectedClipXml({
                ref: `sfx-${sfx.sfxType}`,
                name: `SFX ${sfx.sfxType}`,
                lane: -1,
                offset: secondsToRational(sfx.runOffset, fps),
                start: "0s",
                duration: secondsToRational(sfx.durationSec, fps),
              })
            ),
        ]
          .join("\n              ")
        const durationFrames = toFrames(sourceEnd - sourceStart, fps)
        const clip = clipXml({
          ref: assetIds.get(run.file)!,
          name: path.basename(run.file),
          offset: framesToRational(offsetFrames, fps),
          start: secondsToRational(sourceStart, fps),
          duration: framesToRational(durationFrames, fps),
          children: children || undefined,
          zoomAnimation: zoom
            ? {
                startScale: 1,
                endScale: zoom.scale,
                position: zoom.position,
                durationSec: sourceEnd - sourceStart,
                fps,
              }
            : undefined,
        })
        offsetFrames += durationFrames
        return clip
      })

      // Insert a transition before this run's clips if one is specified.
      const transition = transitionSet.get(index)
      if (transition && index > 0) {
        return [transitionXml(transition, fps), ...runClips]
      }
      return runClips
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

const SFX_DISPLAY_NAMES: Record<SfxType, string> = {
  whoosh: "Whoosh",
  transition: "Transition",
  pop: "Pop",
  swoosh: "Swoosh",
  thud: "Thud",
}

function sfxAssetXml(sfxType: SfxType, project: StoredProject): string {
  const id = `sfx-${sfxType}`
  const name = SFX_DISPLAY_NAMES[sfxType]
  const absolutePath = sfxPath(sfxType)
  const src = esc(`file://${absolutePath.split(path.sep).map(encodeURIComponent).join("/")}`)
  const duration = secondsToRational(SFX_DURATIONS[sfxType], project.fps)

  return (
    `<asset id="${id}" name="${esc(name)}" ` +
    `hasAudio="1" hasVideo="0" ` +
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
  /** Connected clips (`lane="1"` and up), already rendered as XML. */
  children?: string
  /** Animated zoom: start scale, end scale, position, and duration. */
  zoomAnimation?: {
    startScale: number
    endScale: number
    position: ZoomPosition
    durationSec: number
    fps: number
  }
}): string {
  const attrs =
    `name="${esc(clip.name)}" ref="${clip.ref}" ` +
    `offset="${clip.offset}" start="${clip.start}" duration="${clip.duration}"`

  let transform: string | undefined
  if (clip.zoomAnimation) {
    const { startScale, endScale, position, durationSec, fps } =
      clip.zoomAnimation
    const pos = zoomPositionOffset(position)
    const durationRational = secondsToRational(durationSec, fps)
    transform = [
      `<adjust-transform>`,
      `  <param name="position" keyframeTimes="0s ${durationRational}" keyframeValues="0 0 ${pos.x} ${pos.y}"/>`,
      `  <param name="scale" keyframeTimes="0s ${durationRational}" keyframeValues="${startScale} ${startScale} ${endScale} ${endScale}"/>`,
      `</adjust-transform>`,
    ].join("\n              ")
  }

  const contents = [transform, clip.children].filter(Boolean).join("\n              ")

  if (!contents) return `<asset-clip ${attrs}/>`

  return (
    `<asset-clip ${attrs}>\n` +
    `              ${contents}\n` +
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

const TRANSITION_EFFECT_UIDS: Record<TransitionType, string> = {
  crossfade: "FxPlug:4731E73A-88EA-4F8F-9E78-8586B1BDE8B4",
  "zoom-punch": "",
  "dip-to-black": "FxPlug:64C6988A-B44B-4FFE-9772-146E1B7160D8",
  "wipe-left": "",
  "wipe-right": "",
  "wipe-top": "",
  "wipe-bottom": "",
  "wipe-diagonal": "",
  "push-left": "",
  "push-right": "",
  "push-top": "",
  "push-bottom": "",
}

const TRANSITION_DISPLAY_NAMES: Record<TransitionType, string> = {
  crossfade: "Cross Dissolve",
  "zoom-punch": "Cross Dissolve",
  "dip-to-black": "Dip to Color Dissolve",
  "wipe-left": "Wipe Left",
  "wipe-right": "Wipe Right",
  "wipe-top": "Wipe Up",
  "wipe-bottom": "Wipe Down",
  "wipe-diagonal": "Diagonal Wipe",
  "push-left": "Push Left",
  "push-right": "Push Right",
  "push-top": "Push Up",
  "push-bottom": "Push Down",
}

const WIPE_ANGLES: Record<string, number> = {
  "wipe-left": 90,
  "wipe-right": 270,
  "wipe-top": 0,
  "wipe-bottom": 180,
  "wipe-diagonal": 315,
}

const PUSH_DIRECTIONS: Record<string, string> = {
  "push-left": "left",
  "push-right": "right",
  "push-top": "top",
  "push-bottom": "bottom",
}

function transitionXml(
  transition: TransitionSpec,
  fps: number
): string {
  const duration = secondsToRational(transition.durationSec, fps)
  const name = TRANSITION_DISPLAY_NAMES[transition.type]
  const uid = TRANSITION_EFFECT_UIDS[transition.type]

  if (uid) {
    return (
      `<transition name="${esc(name)}" duration="${duration}">\n` +
      `              <effect name="${esc(name)}" uid="${uid}"/>\n` +
      `            </transition>`
    )
  }
  return `<transition name="${esc(name)}" duration="${duration}"/>`
}
