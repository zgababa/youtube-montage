/**
 * Step 3 — speech to words, with timings.
 *
 * The output of this step is the foundation everything else stands on. A span
 * decision, a scene placement, and a chapter timecode are all ultimately a pair
 * of numbers that came from here.
 */

import { createStep } from "@mastra/core/workflows"

import { audioPathFor } from "../lib/audio"
import { readStoredProject, updateProject } from "../lib/project"
import { transcribeFile } from "../lib/stt"
import type { Word } from "../schemas"
import { PipelineIO, reporter, runStep } from "./shared"

export const transcribeStep = createStep({
  id: "transcribe",
  description: "Transcribe each audio track with word-level timestamps",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  execute: async ({ inputData, writer }) => {
    const report = reporter("transcribe", writer)
    const { projectPath } = inputData

    return runStep(report, async () => {
      const project = await readStoredProject(projectPath)
      const withAudio = project.media.filter((file) => file.hasAudio)

      const words: Word[] = []
      const totalSec = withAudio.reduce(
        (sum, file) => sum + file.durationSec,
        0
      )
      let doneSec = 0

      for (const file of withAudio) {
        await report.detail(file.path)
        const fileWords = await transcribeFile(
          audioPathFor(project.id, file.path),
          {
            sourceFile: file.path,
            onProgress: (fraction, phase) => {
              void report.progress(
                (doneSec + fraction * file.durationSec) / totalSec,
                `${file.path} — ${phase}`
              )
            },
          }
        )
        doneSec += file.durationSec
        words.push(...fileWords)
        await report.log(`${file.path} — ${fileWords.length} words`)
      }

      if (words.length === 0) {
        throw new Error(
          "Transcription returned no words. Check the audio actually contains speech, and that ASSEMBLYAI_API_KEY is valid."
        )
      }

      // Sorted by time within each file, files in the order they were scanned.
      // Segment building depends on this: a word out of order would split a
      // segment in the wrong place and shift every span that follows.
      words.sort((a, b) =>
        a.file === b.file ? a.start - b.start : a.file.localeCompare(b.file)
      )

      await updateProject(projectPath, (current) => ({
        ...current,
        transcript: { words },
      }))

      await report.emit("transcript", {
        wordCount: words.length,
        durationSec: words[words.length - 1].end - words[0].start,
        fileCount: withAudio.length,
      })

      return { projectPath }
    })
  },
})
