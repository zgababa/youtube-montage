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

import { isNumbered } from "./media"
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
  media: MediaFile[]
): TimelineRun[] {
  assertSingleTranscriptionSource(media)

  const kept = keptSegments(segments, spans)
  const runs: TimelineRun[] = []
  // The index of the last kept segment folded into the current run — used to
  // tell "nothing was cut between these two" from "these two just happen to
  // share a file", which same-file alone can't distinguish once a cut has
  // removed the segments between them.
  let lastIndex = -Infinity

  for (const segment of kept) {
    const current = runs[runs.length - 1]
    const adjacent = segment.index === lastIndex + 1

    if (current && adjacent && current.file === segment.file) {
      current.sourceEnd = segment.end
    } else {
      runs.push({
        file: segment.file,
        sourceStart: segment.start,
        sourceEnd: segment.end,
      })
    }
    lastIndex = segment.index
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
 * (`01 - `, `02 - `, per `isNumbered`), each with its own scratch audio and no
 * separate mic, exactly the fork's own 6-file project this feature was built
 * for. The numbering convention is the user's explicit claim that these files
 * play in that order; nothing here should second-guess it.
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
  if (ambiguous.every((file) => isNumbered(file.path))) return

  throw new Error(
    "Multiple camera files are marked for transcription with no identified " +
      "mic, and they aren't a numbered sequence (" +
      ambiguous.map((file) => file.path).join(", ") +
      "). The FCPXML export can't tell what order they belong in — fix the " +
      "pairing in project settings, or number the files, before exporting."
  )
}
