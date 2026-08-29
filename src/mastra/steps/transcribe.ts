/**
 * Step 3 — speech to words, with timings.
 *
 * The output of this step is the foundation everything else stands on. A span
 * decision, a scene placement, and a chapter timecode are all ultimately a pair
 * of numbers that came from here.
 */

import { audioPathFor } from "../lib/audio"
import { anchorWords, compareForScript } from "../lib/media"
import { readStoredProject, updateProject } from "../lib/project"
import { transcribeFile } from "../lib/stt"
import type { Word } from "../schemas"
import type { PipelineWriter } from "../stream/contract"
import { extractProjectAudio } from "./extract-audio"
import { reporter } from "./shared"

/**
 * The body of the step, callable on its own — audio extraction included.
 *
 * `app/api/pipeline/route.ts` reuses it for the "Transcribe" action outside
 * the workflow: this only ever writes `transcript.words`, nothing
 * downstream, so re-running it doesn't cascade into cleanup or scenes the
 * way a full pipeline run does. Extraction is folded in rather than left a
 * separate action — nobody reviews it, it's a silent, cache-aware
 * prerequisite (`audioIsFresh`), so splitting it out would just be a second
 * button for something nobody chooses to run on its own.
 */
export async function transcribeProject(
  projectPath: string,
  writer: PipelineWriter | undefined
) {
  const report = reporter("transcribe", writer)
  const project = await readStoredProject(projectPath)
  await extractProjectAudio(project, report)
  // Not every file with sound is a transcription source. A camera rolling
  // alongside a separate mic captures the same speech, and transcribing
  // both would put the whole talk in the script twice.
  const sources = project.media.filter(
    (file) => file.hasAudio && file.transcribe
  )

  if (sources.length === 0) {
    throw new Error(
      "No media file is marked as a transcription source. Pick one in the project's Media tab — with a camera and a separate mic, that's usually the mic."
    )
  }

  const words: Word[] = []
  const totalSec = sources.reduce((sum, file) => sum + file.durationSec, 0)
  let doneSec = 0

  for (const file of sources) {
    await report.detail(file.path)
    const fileWords = await transcribeFile(
      audioPathFor(project.id, file.path),
      {
        sourceFile: file.path,
        hints: project.transcriptionHints,
        onProgress: (fraction, phase) => {
          void report.progress(
            (doneSec + fraction * file.durationSec) / totalSec,
            `${file.path} — ${phase}`
          )
        },
      }
    )
    doneSec += file.durationSec
    // Onto the anchor clock before anything else sees them: every span,
    // scene window and chapter below this line assumes one timeline.
    words.push(...anchorWords(fileWords, file))
    await report.log(
      `${file.path} — ${fileWords.length} words` +
        (file.voices ? ` (as ${file.voices})` : "")
    )
  }

  if (words.length === 0) {
    throw new Error(
      "Transcription returned no words. Check the audio actually contains speech, and that ASSEMBLYAI_API_KEY is valid."
    )
  }

  // A wrong-signed offset is otherwise invisible: the transcript reads
  // perfectly and every timecode is shifted off the front of the clip.
  const early = words.filter((word) => word.start < 0).length
  if (early > 0) {
    await report.log(
      `warning: ${early} words land before 00:00 — check the sync offset`
    )
  }

  // Sorted by time within each file, files in script order. Segment
  // building depends on this: a word out of order would split a segment in
  // the wrong place and shift every span that follows. Across files it's
  // what decides the narrative the copy agent reads, so a `01 - `, `02 - `
  // naming convention is honoured here rather than raw path order.
  words.sort((a, b) =>
    a.file === b.file ? a.start - b.start : compareForScript(a.file, b.file)
  )

  await updateProject(projectPath, (current) => ({
    ...current,
    transcript: { words },
  }))

  const stats = {
    wordCount: words.length,
    durationSec: words[words.length - 1].end - words[0].start,
    fileCount: sources.length,
  }
  await report.emit("transcript", stats)
  return stats
}
