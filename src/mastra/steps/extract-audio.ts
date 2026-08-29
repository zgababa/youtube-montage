/**
 * Step 2 — audio only, never video.
 *
 * Source footage is read-only input (idea.md §2). Nothing here touches the
 * video stream: `-vn` drops it entirely, and the output goes to `os.tmpdir()`
 * rather than into the project folder.
 */

import path from "node:path"

import { extractAudio } from "../lib/ffmpeg"
import { audioIsFresh, audioPathFor } from "../lib/audio"
import { toAbsolute } from "../lib/paths"
import type { StoredProject } from "../schemas"
import type { StepReporter } from "./shared"

/**
 * The body of the step, callable on its own — and also folded straight into
 * `transcribeProject` (`transcribe.ts`), since audio extraction is a silent
 * prerequisite nobody reviews, not a decision point. Takes an already-loaded
 * project and an already-built report so a caller doing both isn't paying for
 * two reads of `project.json` or emitting two `step` rows for what reads to
 * the user as one action.
 */
export async function extractProjectAudio(
  project: StoredProject,
  report: StepReporter
) {
  const { path: projectPath, id: projectId } = project

  if (!project.media.some((file) => file.hasAudio)) {
    throw new Error(
      "None of the media files have an audio track — there is nothing to transcribe."
    )
  }

  // Only the transcription sources. Extracting the camera's scratch audio
  // when a separate mic is the source is pure waste — nothing reads it.
  const sources = project.media.filter(
    (file) => file.hasAudio && file.transcribe
  )

  if (sources.length === 0) {
    throw new Error(
      "No media file is marked as a transcription source. Pick one in the project's Media tab — with a camera and a separate mic, that's usually the mic."
    )
  }

  const totalSec = sources.reduce((sum, file) => sum + file.durationSec, 0)
  let doneSec = 0

  for (const file of sources) {
    const source = toAbsolute(projectPath, file.path)
    const audio = audioPathFor(projectId, file.path)

    if (await audioIsFresh(source, audio)) {
      doneSec += file.durationSec
      await report.progress(doneSec / totalSec, file.path)
      await report.log(`${path.basename(file.path)} → cached`)
      continue
    }

    await report.detail(file.path)
    await extractAudio(source, audio, {
      durationSec: file.durationSec,
      // Weighted by duration, so a 40-minute A-cam doesn't share a
      // progress bar equally with a 30-second pickup.
      onProgress: (fraction) => {
        void report.progress(
          (doneSec + fraction * file.durationSec) / totalSec,
          file.path
        )
      },
    })
    doneSec += file.durationSec
    await report.log(`${path.basename(file.path)} → audio`)
  }
}
