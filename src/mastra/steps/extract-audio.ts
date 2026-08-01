/**
 * Step 2 — audio only, never video.
 *
 * Source footage is read-only input (idea.md §2). Nothing here touches the
 * video stream: `-vn` drops it entirely, and the output goes to `os.tmpdir()`
 * rather than into the project folder.
 */

import { createStep } from "@mastra/core/workflows"
import path from "node:path"

import { extractAudio } from "../lib/ffmpeg"
import { audioPathFor } from "../lib/audio"
import { readStoredProject } from "../lib/project"
import { toAbsolute } from "../lib/paths"
import { PipelineIO, reporter, runStep } from "./shared"

export const extractAudioStep = createStep({
  id: "extract-audio",
  description: "Extract mono 16kHz audio from each media file that has any",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  execute: async ({ inputData, writer }) => {
    const report = reporter("extract-audio", writer)
    const { projectPath } = inputData

    return runStep(report, async () => {
      const project = await readStoredProject(projectPath)
      const withAudio = project.media.filter((file) => file.hasAudio)

      if (withAudio.length === 0) {
        throw new Error(
          "None of the media files have an audio track — there is nothing to transcribe."
        )
      }

      const totalSec = withAudio.reduce(
        (sum, file) => sum + file.durationSec,
        0
      )
      let doneSec = 0

      for (const file of withAudio) {
        await report.detail(file.path)
        await extractAudio(
          toAbsolute(projectPath, file.path),
          audioPathFor(project.id, file.path),
          {
            durationSec: file.durationSec,
            // Weighted by duration, so a 40-minute A-cam doesn't share a
            // progress bar equally with a 30-second pickup.
            onProgress: (fraction) => {
              void report.progress(
                (doneSec + fraction * file.durationSec) / totalSec,
                file.path
              )
            },
          }
        )
        doneSec += file.durationSec
        await report.log(`${path.basename(file.path)} → audio`)
      }

      return { projectPath }
    })
  },
})
