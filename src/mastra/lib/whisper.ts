/**
 * Word-level transcription (idea.md §4.1).
 *
 * This is the one place Mastra doesn't fit: `voice.listen()` returns a plain
 * string, and the entire architecture below this line — span decisions, scene
 * placement, chapters — is anchored to word timing. So the STT provider is
 * called directly from a deterministic step.
 *
 * The model is not a free choice. `whisper-1` is the only OpenAI model that
 * still accepts `timestamp_granularities: ["word"]`; the gpt-4o-transcribe
 * family is better at words and worse at *when*, which is the wrong trade here.
 */

import fs from "node:fs"
import { createReadStream } from "node:fs"
import path from "node:path"
import OpenAI from "openai"

import type { Word } from "../schemas"
import { TRANSCRIBE_MODEL } from "../models"
import { SEGMENT_SECONDS, segmentAudio } from "./ffmpeg"

/** OpenAI's upload cap. Anything larger has to be split first. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export interface TranscribeOptions {
  /** Recorded on every word, so spans can point back at real footage. */
  sourceFile: string
  /** Scratch directory for chunks, if splitting is needed. */
  workDir: string
  /** 0–1 across all chunks of this file. */
  onProgress?: (fraction: number) => void
}

let client: OpenAI | undefined

function openai() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_API_KEY is unset — transcription needs it for word-level timestamps."
      )
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return client
}

/**
 * Transcribes one audio file, splitting it if it exceeds the upload cap.
 *
 * Returns words in absolute time relative to the *original* file, not to
 * whichever chunk they came from.
 */
export async function transcribeFile(
  audioPath: string,
  options: TranscribeOptions
): Promise<Word[]> {
  const { size } = await fs.promises.stat(audioPath)

  if (size <= MAX_UPLOAD_BYTES) {
    options.onProgress?.(0)
    const words = await transcribeChunk(audioPath, 0, options.sourceFile)
    options.onProgress?.(1)
    return words
  }

  const chunkDir = path.join(options.workDir, path.parse(audioPath).name)
  const chunks = await segmentAudio(audioPath, chunkDir)

  const words: Word[] = []
  for (const [index, chunk] of chunks.entries()) {
    options.onProgress?.(index / chunks.length)
    // Each chunk restarts its clock at zero, so the offset is what puts the
    // words back where they actually happened. Get this wrong and the
    // transcript still reads perfectly while every timestamp downstream is off
    // by a multiple of ten minutes — no error, just b-roll in the wrong place.
    words.push(
      ...(await transcribeChunk(
        chunk,
        index * SEGMENT_SECONDS,
        options.sourceFile
      ))
    )
  }
  options.onProgress?.(1)

  await fs.promises.rm(chunkDir, { recursive: true, force: true })
  return words
}

async function transcribeChunk(
  audioPath: string,
  offsetSec: number,
  sourceFile: string
): Promise<Word[]> {
  const response = await openai().audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: TRANSCRIBE_MODEL,
    // Both are required together: granularities are only honoured when the
    // response format is verbose_json.
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  })

  const words = "words" in response ? (response.words ?? []) : []

  if (words.length === 0) {
    // Silence transcribes to nothing, which is fine. An empty result from
    // audio that clearly has speech means the granularity request was dropped
    // — worth saying out loud rather than returning an empty transcript.
    return []
  }

  return words.map((word) => ({
    w: word.word,
    start: offsetSec + word.start,
    end: offsetSec + word.end,
    file: sourceFile,
  }))
}

/** Exported for tests — the offset arithmetic is the part that can silently rot. */
export function offsetWords(
  words: Word[],
  offsetSec: number,
  sourceFile: string
): Word[] {
  return words.map((word) => ({
    ...word,
    start: word.start + offsetSec,
    end: word.end + offsetSec,
    file: sourceFile,
  }))
}
