/**
 * Between the approved spans and the FCPXML spine.
 *
 * `keptSegments` already knows which segments survive the cut — see
 * `segments.ts`. What it doesn't know is which of those form one continuous
 * strip of a physical file, because that's not its job: a "run" is a concept
 * this v1 export invents, not one the cleanup pass needs.
 *
 * `docs/glossary.md` spells out the ambiguity this term risks: a "run" here
 * is a contiguous stretch of one source file that survives the cuts, not a
 * Mastra pipeline run. Both words are in play in this codebase; only one of
 * them means "keep this footage".
 */

import { allNumbered } from "./media"
import type { Segment } from "./segments"
import { keptSegments } from "./segments"
import type { MediaFile, Span } from "../schemas"

export interface TimelineRun {
  /** Source file, as `segment.file` — a project-relative camera path. */
  file: string
  /** Seconds, in the physical file's own clock (see `anchorWords`). */
  sourceStart: number
  sourceEnd: number
}

/**
 * Longest silence the exported timeline keeps between two kept segments of
 * the same file.
 *
 * `cleanup` only ever decides what to cut based on content (filler,
 * redundant, …) — a natural pause between two kept sentences is never itself
 * a cut, so it survives into `spans` at full length. Left alone, that's every
 * breath and thinking-pause in the recording, playing back exactly as long as
 * it was in the room. This trims it at export time only: `spans` and the
 * script scenes read from are untouched, only the timeline handed to DaVinci
 * gets tighter.
 *
 * Segments never break on a gap shorter than `PAUSE_SEC` (0.6s, see
 * `segments.ts`), so this only ever fires on pauses that were already at
 * least that long — it has no effect on the short, natural gaps between
 * words within a sentence.
 *
 * A default, not a fixed rule: `project.maxSilenceSec` (`schemas.ts`) is what
 * the `fcpxml` step actually reads, adjustable at its review gate. This is
 * only the value a brand new project starts with.
 */
export const DEFAULT_MAX_SILENCE_SEC = 0.3

/**
 * Groups the kept segments into contiguous per-file runs.
 *
 * Two segments merge into one run only when they are adjacent in the kept
 * list *and* share a file — consecutive segments from different files stay
 * two runs even when nothing was cut between them, because a run spanning two
 * files would claim a source range that doesn't exist in either physical
 * file.
 *
 * Checks the multi-camera guard first (see `assertSingleTranscriptionSource`)
 * — a run built from an ambiguous camera setup would chain files together as
 * if their footage were sequential when it might not be, which is a wrong
 * timeline dressed as a correct one.
 */
export function buildKeptRuns(
  segments: Segment[],
  spans: Span[],
  media: MediaFile[],
  maxSilenceSec: number = DEFAULT_MAX_SILENCE_SEC
): TimelineRun[] {
  assertSingleTranscriptionSource(media)

  const kept = keptSegments(segments, spans)
  const runs: TimelineRun[] = []
  // The index of the last kept segment folded into the current run — used to
  // tell "nothing was cut between these two" from "these two just happen to
  // share a file", which same-file alone can't distinguish once a cut has
  // removed the segments between them.
  let lastIndex = -Infinity
  // The raw end of the previously kept segment, before any silence capping —
  // the gap check needs the true pause, not a run boundary already shortened
  // by a previous cap.
  let previousEnd = -Infinity

  for (const segment of kept) {
    const current = runs[runs.length - 1]
    const adjacent = segment.index === lastIndex + 1
    const sameFile = current !== undefined && current.file === segment.file
    const gap = segment.start - previousEnd

    if (current && adjacent && sameFile && gap <= maxSilenceSec) {
      current.sourceEnd = segment.end
    } else if (current && adjacent && sameFile) {
      // A cut never separated these two — cleanup left the pause between
      // them alone — but it's long enough to trim at export time. Only its
      // last maxSilenceSec survives, as a short lead-in to what follows.
      runs.push({
        file: segment.file,
        sourceStart: segment.start - maxSilenceSec,
        sourceEnd: segment.end,
      })
    } else {
      runs.push({
        file: segment.file,
        sourceStart: segment.start,
        sourceEnd: segment.end,
      })
    }
    lastIndex = segment.index
    previousEnd = segment.end
  }

  return runs
}

/**
 * Refuses an ambiguous multi-camera setup rather than guess at it.
 *
 * `assignRoles`/`autoPair` (`media.ts`) resolve the common case — one camera,
 * one mic — by pointing the mic's `voices` at the camera it belongs to. What
 * they can't resolve is several simultaneous cameras with no separate mic to
 * anchor on: every one of them ends up `transcribe: true` with `voices: null`,
 * because nothing told the pairing which file's audio to trust.
 *
 * That shape alone isn't enough to call it ambiguous, though — it's also what
 * a deliberately sequential shoot looks like: several numbered files
 * (`01 - `, `02 - `, per `allNumbered`/`isNumbered` in `media.ts`), each with
 * its own scratch audio and no separate mic, exactly the fork's own 6-file
 * project this feature was built for. The numbering convention is the user's
 * explicit claim that these files play in that order; nothing here should
 * second-guess it.
 *
 * So the guard only fires when *not every* ambiguous file carries that claim.
 * With no numbering to lean on, file order is only the order files happened
 * to sort in — not a timeline order — and chaining their kept segments end to
 * end would produce a timeline that imports cleanly into DaVinci and is
 * simply wrong, which is worse than refusing to export at all.
 */
export function assertSingleTranscriptionSource(media: MediaFile[]) {
  const ambiguous = media.filter(
    (file) => file.transcribe && file.voices === null
  )
  if (ambiguous.length <= 1) return
  if (allNumbered(ambiguous)) return

  throw new Error(
    "Multiple camera files are marked for transcription with no identified " +
      "mic, and they aren't a numbered sequence (" +
      ambiguous.map((file) => file.path).join(", ") +
      "). The FCPXML export can't tell what order they belong in — fix the " +
      "pairing in project settings, or number the files, before exporting."
  )
}
