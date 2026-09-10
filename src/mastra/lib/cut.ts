/**
 * Executing the cut the approved spans already decided (issue #27).
 *
 * Nothing here decides what to keep — that's `cleanupStep`/`spans`, already
 * approved by the time anything in this module runs. `buildKeptRuns`
 * (`timeline.ts`) already turns those spans into the ordered, per-file runs
 * that survive the cut; this module only adds what `timeline.ts` never
 * needed, because FCPXML only ever *described* a cut for DaVinci to perform:
 * an absolute source path per run, and the ffmpeg calls that actually produce
 * a single cut video file from them.
 *
 * Split in two on purpose, per issue #27's acceptance criteria:
 *
 *   - `buildCutPlan` is pure — spans, words and media in, an ordered list of
 *     source segments to extract and concatenate out. Testable in memory,
 *     no ffmpeg involved (`tests/cut.test.ts`).
 *   - `cutMedia` is not. It spawns ffmpeg once per plan item plus once to
 *     concatenate, and is exercised only by hand/integration — the same line
 *     `ffmpeg.ts`'s other spawning functions (`extractAudio`, `encodeProRes`,
 *     …) already sit on the wrong side of.
 */

import fs from "node:fs/promises"
import path from "node:path"

import { concatSegments, extractSegment } from "./ffmpeg"
import { cutVideoPath, toAbsolute, tmpDir } from "./paths"
import { buildSegments } from "./segments"
import { buildKeptRuns } from "./timeline"
import type { StoredProject } from "../schemas"

/** One source segment the output file extracts and concatenates, in order. */
export interface CutPlanItem {
  /** Absolute path to the source file this piece is extracted from. */
  sourcePath: string
  /** Project-relative path, as stored in `project.media` and `TimelineRun.file`. */
  file: string
  /** Seconds, in the physical file's own clock — same domain as `TimelineRun`. */
  sourceStart: number
  sourceEnd: number
}

/** Ordered source segments to extract and concatenate. Empty is valid — see below. */
export type CutPlan = CutPlanItem[]

/**
 * Translates a project's approved spans into an ordered cut plan.
 *
 * Reuses `buildKeptRuns` rather than re-deciding anything: the run grouping
 * (contiguous per-file stretches, natural-pause trimming) is exactly "which
 * source segments survive, in order" — the same question the FCPXML export
 * already answers. This only resolves each run's file to where it actually
 * lives on disk, which `timeline.ts` never needed because FCPXML records
 * project-relative URLs itself (`fcpxml.ts`'s `fileUrl`).
 *
 * Throws when spans aren't approved yet, same posture as `timelineStep`:
 * there's no cut list to execute, not an empty one — approving *nothing kept*
 * is what the empty-plan case below is for.
 */
export function buildCutPlan(project: StoredProject): CutPlan {
  if (!project.cleanupApprovedAt) {
    throw new Error(
      "Cleanup hasn't been approved — there's no approved cut list to execute yet."
    )
  }

  const segments = buildSegments(project.transcript.words)
  const runs = buildKeptRuns(
    segments,
    project.spans,
    project.media,
    project.maxSilenceSec
  )

  // Every span cut is a legitimate outcome (a take rejected outright, say),
  // not a bug — `cutMedia` is the one that turns "nothing to concatenate"
  // into an explicit error, since producing a zero-length video silently
  // would be the wrong failure to hide.
  return runs.map((run) => ({
    sourcePath: toAbsolute(project.path, run.file),
    file: run.file,
    sourceStart: run.sourceStart,
    sourceEnd: run.sourceEnd,
  }))
}

export interface CutResult {
  outputPath: string
  segmentCount: number
  totalDurationSec: number
}

/**
 * Extracts every plan item and concatenates them, in order, into one cut
 * video file at `cutVideoPath(project.path)`.
 *
 * Each item is re-encoded on extraction (`extractSegment`) rather than
 * stream-copied: `-ss`/`-to` land on arbitrary word boundaries, almost never
 * a keyframe, and a stream copy from a non-keyframe either fails or starts
 * from the nearest earlier keyframe — quietly including a sliver of content
 * that was supposed to be cut. Re-encoding is what makes the seek accurate.
 * The pieces then share a codec, so the final concat is a cheap stream copy
 * (`concatSegments`) — no second re-encode of the whole video.
 *
 * Runs the extractions sequentially, one ffmpeg process at a time, matching
 * `exportStep`'s concurrency-1 choice for the same reason: this already
 * saturates a laptop on its own.
 */
export async function cutMedia(project: StoredProject): Promise<CutResult> {
  const plan = buildCutPlan(project)

  if (plan.length === 0) {
    throw new Error(
      "Every approved span is cut — there's nothing left to produce a video from."
    )
  }

  const workDir = tmpDir("cut", project.id)
  await fs.rm(workDir, { recursive: true, force: true })
  await fs.mkdir(workDir, { recursive: true })

  try {
    const pieces: string[] = []
    for (const [index, item] of plan.entries()) {
      const piece = path.join(workDir, `${String(index).padStart(5, "0")}.mp4`)
      await extractSegment(item.sourcePath, item.sourceStart, item.sourceEnd, piece)
      pieces.push(piece)
    }

    const listFile = path.join(workDir, "concat.txt")
    // The concat demuxer's own quoting: single-quoted, with embedded single
    // quotes escaped as `'\''` — the one format it parses reliably regardless
    // of what characters are in a project's folder names.
    const listContents = pieces
      .map((piece) => `file '${piece.replace(/'/g, "'\\''")}'`)
      .join("\n")
    await fs.writeFile(listFile, listContents, "utf8")

    const outputPath = cutVideoPath(project.path)
    await concatSegments(listFile, outputPath)

    return {
      outputPath,
      segmentCount: plan.length,
      totalDurationSec: plan.reduce(
        (sum, item) => sum + (item.sourceEnd - item.sourceStart),
        0
      ),
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true })
  }
}
