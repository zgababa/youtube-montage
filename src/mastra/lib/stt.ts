/**
 * Word-level transcription (idea.md §4.1), via AssemblyAI.
 *
 * This is the one place Mastra doesn't fit: `voice.listen()` returns a plain
 * string, and the entire architecture below this line — span decisions, scene
 * placement, chapters — is anchored to word timing. So the STT provider is
 * called directly from a deterministic step.
 *
 * Two provider details shape everything in this file:
 *
 *   1. `disfluencies: true` is not optional here. AssemblyAI strips "um", "uh",
 *      "hmm" and friends by default, and cutting exactly those is half of what
 *      step 4 exists to do. Without the flag the filler category is silently
 *      empty and the cleanup agent looks like it isn't working.
 *   2. Timings come back in **milliseconds**. Everything downstream — spans,
 *      scene windows, chapters, the shot list — is in seconds. The conversion
 *      happens once, here, and nowhere else.
 */

import { AssemblyAI } from "assemblyai"

import type { TranscriptionHints, Word } from "../schemas"
import { TRANSCRIBE_MODELS } from "../models"

/** How often to ask whether the job is done. */
const POLL_INTERVAL_MS = 3000

/** Coarse but honest: these are phase markers, not a measured percentage. */
const PHASE_PROGRESS: Record<string, number> = {
  uploading: 0.1,
  queued: 0.3,
  processing: 0.6,
}

export interface TranscribeOptions {
  /** Recorded on every word, so spans can point back at real footage. */
  sourceFile: string
  /** What the recording is about, and the spellings to prefer. */
  hints?: TranscriptionHints
  /** Phase changes for this file, 0–1. There is no finer signal to report. */
  onProgress?: (fraction: number, phase: string) => void
}

let client: AssemblyAI | undefined

function assembly() {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    throw new Error(
      "ASSEMBLYAI_API_KEY is unset — transcription needs it for word-level timestamps."
    )
  }
  client ??= new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY })
  return client
}

/**
 * Transcribes one audio file.
 *
 * No chunking: AssemblyAI accepts 5 GB / 10 hours per job, which an extracted
 * mono mp3 will not reach, so the file goes up whole and the timings come back
 * already relative to it. That removes the offset arithmetic this step used to
 * need — the failure mode where the transcript reads perfectly while every
 * timestamp is wrong by a multiple of the chunk length simply can't happen now.
 */
export async function transcribeFile(
  audioPath: string,
  options: TranscribeOptions
): Promise<Word[]> {
  const { sourceFile, hints, onProgress } = options
  const ai = assembly()

  const report = (phase: string) =>
    onProgress?.(PHASE_PROGRESS[phase] ?? 0.6, phase)

  report("uploading")
  // Uploaded explicitly rather than letting `transcribe()` do it, so the step
  // can say "uploading" for what is, on a long recording, the slow part.
  const audioUrl = await ai.files.upload(audioPath)

  report("queued")
  const submitted = await ai.transcripts.submit({
    audio: audioUrl,
    speech_models: TRANSCRIBE_MODELS,
    // See the file header — this one is load-bearing for step 4.
    disfluencies: true,
    // Omitted rather than sent empty: an empty prompt is not the same request
    // as no prompt, and there's no reason to find out how it's treated.
    ...(hints?.prompt.trim() ? { prompt: hints.prompt.trim() } : {}),
    ...(hints?.keyterms.length ? { keyterms_prompt: hints.keyterms } : {}),
  })

  const transcript = await poll(submitted.id, report)
  onProgress?.(1, "done")

  if (transcript.status === "error") {
    throw new Error(`AssemblyAI failed on ${sourceFile}: ${transcript.error}`)
  }

  return toWords(transcript.words ?? [], sourceFile)
}

async function poll(
  transcriptId: string,
  report: (phase: string) => void
): Promise<Awaited<ReturnType<AssemblyAI["transcripts"]["get"]>>> {
  // Hand-rolled rather than `waitUntilReady()` so the queued → processing
  // transition reaches the UI. On a long file that's the difference between a
  // progress bar that moves once and one that looks hung.
  let lastPhase = ""

  for (;;) {
    const transcript = await assembly().transcripts.get(transcriptId)

    if (transcript.status === "completed" || transcript.status === "error") {
      return transcript
    }

    if (transcript.status !== lastPhase) {
      lastPhase = transcript.status
      report(transcript.status)
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

/**
 * Milliseconds to seconds, and into our own shape.
 *
 * Exported for tests: this conversion is the whole contract between the
 * provider and everything downstream, and a factor of 1000 in the wrong place
 * produces a transcript that reads correctly and cuts in absurd locations.
 */
export function toWords(
  words: { text: string; start: number; end: number }[],
  sourceFile: string
): Word[] {
  return words.map((word) => ({
    w: word.text,
    start: word.start / 1000,
    end: word.end / 1000,
    file: sourceFile,
  }))
}
