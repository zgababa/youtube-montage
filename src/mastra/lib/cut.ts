/**
 * Executing the cut the approved spans already decided (issue #27).
 *
 * Nothing here decides what to keep — that's `cleanupStep`/`spans`, already
 * approved by the time anything in this module runs. `keptRunsForProject`
 * (`timeline.ts`) already turns those spans into the ordered, per-file runs
 * that survive the cut; this module only adds what `timeline.ts` never
 * needed, because FCPXML only ever *described* a cut for DaVinci to perform
 * (`docs/adr/0001-…`): an absolute source path per run, and the ffmpeg calls
 * that actually produce a single cut video file from them. Why both outputs
 * exist side by side is `docs/adr/0008-…`.
 *
 * Split in two on purpose, per issue #27's acceptance criteria:
 *
 *   - `buildCutPlan` and `buildConcatList` are pure — spans, words and media
 *     in, an ordered list of source ranges to extract and concatenate out.
 *     Testable in memory, no ffmpeg involved (`tests/cut.test.ts`).
 *   - `cutMedia` is not. It spawns ffmpeg once per plan item plus once to
 *     concatenate, and is exercised only by hand/integration — the same line
 *     `ffmpeg.ts`'s other spawning functions (`extractAudio`, `encodeProRes`,
 *     …) already sit on the wrong side of.
 */

import fs from "node:fs/promises"
import path from "node:path"

import { concatFiles, extractRange } from "./ffmpeg"
import { cutVideoPath, toAbsolute, tmpDir } from "./paths"
import { keptRunsForProject, totalRunDuration } from "./timeline"
import type { TimelineRun } from "./timeline"
import type { StoredProject } from "../schemas"

/**
 * One source range the output file extracts and concatenates, in order.
 *
 * A `TimelineRun` — the glossary's `run`, the very same stretch the FCPXML
 * export chains into the spine — plus the one thing performing the cut needs
 * that describing it never did: where the file actually lives on this disk.
 */
export type CutPlanItem = TimelineRun & {
  /** Absolute path to the source file this range is extracted from. */
  sourcePath: string
}

/**
 * Translates a project's approved spans into an ordered cut plan.
 *
 * Reuses `keptRunsForProject` rather than re-deciding anything: the run
 * grouping (contiguous per-file stretches, natural-pause trimming) is exactly
 * "which source ranges survive, in order" — the same question the FCPXML
 * export already answers, and answering it twice is how the described cut and
 * the performed one would drift apart. This only resolves each run's file to
 * where it lives on disk, which `timeline.ts` never needed because FCPXML
 * records project-relative URLs itself (`fcpxml.ts`'s `fileUrl`).
 *
 * Throws when spans aren't approved yet, same posture as `timelineStep`:
 * there's no cut list to execute, not an empty one — approving *nothing kept*
 * is what the empty-plan case below is for.
 */
export function buildCutPlan(project: StoredProject): CutPlanItem[] {
  if (!project.cleanupApprovedAt) {
    throw new Error(
      "Cleanup hasn't been approved — there's no approved cut list to execute yet."
    )
  }

  // Every span cut is a legitimate outcome (a take rejected outright, say),
  // not a bug — `cutMedia` is the one that turns "nothing to concatenate"
  // into an explicit error, since producing a zero-length video silently
  // would be the wrong failure to hide.
  return keptRunsForProject(project).map((run) => ({
    ...run,
    sourcePath: toAbsolute(project.path, run.file),
  }))
}

/**
 * Renders the concat demuxer's own list format: one `file '…'` line per piece,
 * single-quoted, with embedded single quotes escaped as `'\''`.
 *
 * That escaping is the whole reason this is a function rather than a template
 * inline in `cutMedia`: a project folder named `Fabien's takes` is ordinary,
 * and the naive version writes a list file ffmpeg misparses into paths that
 * don't exist. Pure, so `tests/cut.test.ts` can pin it without ffmpeg.
 */
export function buildConcatList(pieces: string[]): string {
  return pieces
    .map((piece) => `file '${piece.replace(/'/g, "'\\''")}'`)
    .join("\n")
}

export interface CutResult {
  outputPath: string
  runCount: number
  totalDurationSec: number
}

/**
 * Extracts every plan item and concatenates them, in order, into one cut
 * video file at `cutVideoPath(project.path)`.
 *
 * Each item is re-encoded on extraction (`extractRange`) rather than
 * stream-copied: `-ss`/`-to` land on arbitrary word boundaries, almost never
 * a keyframe, and a stream copy from a non-keyframe either fails or starts
 * from the nearest earlier keyframe — quietly including a sliver of content
 * that was supposed to be cut. Re-encoding is what makes the seek accurate.
 * The pieces then share a codec *and* their frame rate, pixel format, sample
 * rate and channel layout (see `extractRange`), so the final concat is a cheap
 * stream copy (`concatFiles`) — no second re-encode of the whole video.
 *
 * Runs the extractions sequentially, one ffmpeg process at a time, matching
 * `exportStep`'s concurrency-1 choice for the same reason: this already
 * saturates a laptop on its own.
 *
 * Concatenates to a sibling `.partial` file and renames it into place last.
 * Re-cutting after a span change is expected (issue #27's last criterion), and
 * ffmpeg's `-y` overwrites in place from the first packet: a failure halfway
 * through would leave the previous `cut.mp4` truncated, a stale cut that still
 * looks like the current one. A sibling rather than the temp directory because
 * `tmpDir` is `os.tmpdir()` (`paths.ts`), routinely a different filesystem from
 * the project folder, where `rename` fails with `EXDEV`.
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
      await extractRange(item.sourcePath, piece, {
        startSec: item.sourceStart,
        endSec: item.sourceEnd,
        fps: project.fps,
      })
      pieces.push(piece)
    }

    const listFile = path.join(workDir, "concat.txt")
    await fs.writeFile(listFile, buildConcatList(pieces), "utf8")

    const outputPath = cutVideoPath(project.path)
    const staged = `${outputPath}.partial`
    try {
      await concatFiles(listFile, staged)
      await fs.rename(staged, outputPath)
    } catch (error) {
      await fs.rm(staged, { force: true })
      throw error
    }

    return {
      outputPath,
      runCount: plan.length,
      totalDurationSec: totalRunDuration(plan),
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true })
  }
}
