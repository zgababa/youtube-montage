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
import { audioIsFresh, audioPathFor } from "../lib/audio"
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
        const audio = audioPathFor(project.id, file.path)

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

      return { projectPath }
    })
  },
})
