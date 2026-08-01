/**
 * ffmpeg and ffprobe, as promises.
 *
 * Both are expected on PATH (idea.md §14). Nothing here transcodes video —
 * source footage is read-only input, and the only video this pipeline ever
 * writes is the ProRes render of a generated scene.
 */

import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

export interface ProbeResult {
  durationSec: number
  hasAudio: boolean
}

/** Video and audio containers worth scanning for. */
export const MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".mkv",
  ".avi",
  ".mts",
  ".m2ts",
  ".wav",
  ".mp3",
  ".m4a",
  ".aac",
  ".flac",
])

export function isMediaFile(file: string) {
  return MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase())
}

/* -------------------------------------------------------------------------- */
/* Probing                                                                     */
/* -------------------------------------------------------------------------- */

export async function probe(file: string): Promise<ProbeResult> {
  const json = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-show_streams",
    "-of",
    "json",
    file,
  ])

  const parsed = JSON.parse(json.stdout) as {
    format?: { duration?: string }
    streams?: { codec_type?: string }[]
  }

  return {
    durationSec: Number(parsed.format?.duration ?? 0),
    hasAudio: (parsed.streams ?? []).some((s) => s.codec_type === "audio"),
  }
}

/* -------------------------------------------------------------------------- */
/* Audio extraction                                                            */
/* -------------------------------------------------------------------------- */

export interface ExtractOptions {
  /** 0–1, reported against the input's known duration. */
  onProgress?: (fraction: number) => void
  durationSec?: number
}

/**
 * Pulls mono 16 kHz audio out of a source file.
 *
 * idea.md §4.2 specifies `-vn -ac 1 -ar 16000`; the one change is mp3 rather
 * than WAV, and it isn't cosmetic. Whisper's upload cap is 25 MB, and an hour
 * of 16 kHz mono WAV is roughly 115 MB — every long recording would need
 * splitting. The same audio as mp3 is about a tenth of that, at a bitrate
 * Whisper is entirely happy with, so most files go up in one piece.
 */
export async function extractAudio(
  input: string,
  output: string,
  options: ExtractOptions = {}
): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true })
  await run(
    "ffmpeg",
    [
      "-nostdin",
      "-y",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "4",
      "-progress",
      "pipe:1",
      "-loglevel",
      "error",
      output,
    ],
    {
      onStdout: progressReader(options.durationSec, options.onProgress),
    }
  )
}

/** Fixed-length pieces, for audio too long to upload in one request. */
export const SEGMENT_SECONDS = 600

/**
 * Splits audio into `SEGMENT_SECONDS` pieces, returning them in order.
 *
 * Order is the whole point: the transcriber offsets each piece's word
 * timestamps by its index, so a piece out of position shifts an entire stretch
 * of transcript by ten minutes without any visible error.
 */
export async function segmentAudio(
  input: string,
  outputDir: string
): Promise<string[]> {
  await fs.mkdir(outputDir, { recursive: true })
  const pattern = path.join(outputDir, "chunk_%03d.mp3")

  await run("ffmpeg", [
    "-nostdin",
    "-y",
    "-i",
    input,
    "-f",
    "segment",
    "-segment_time",
    String(SEGMENT_SECONDS),
    // Re-encoding each piece rather than copying: with `-c copy` the segmenter
    // can only cut on frame boundaries, so piece durations drift from the
    // requested 600s and the index-times-600 offset stops being exact.
    "-c:a",
    "libmp3lame",
    "-q:a",
    "4",
    "-loglevel",
    "error",
    pattern,
  ])

  const entries = await fs.readdir(outputDir)
  return entries
    .filter((name) => name.startsWith("chunk_") && name.endsWith(".mp3"))
    .sort()
    .map((name) => path.join(outputDir, name))
}

/* -------------------------------------------------------------------------- */
/* ProRes encoding                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Frames to ProRes 4444 with alpha (idea.md §6).
 *
 * `yuva444p10le` is what carries the alpha channel through. Without it the
 * scenes can only cut away from the footage instead of overlaying it, which is
 * the entire reason the exporter screenshots with `omitBackground`.
 */
export async function encodeProRes(
  framesDir: string,
  fps: number,
  output: string
): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true })
  await run("ffmpeg", [
    "-nostdin",
    "-y",
    "-framerate",
    String(fps),
    "-i",
    path.join(framesDir, "%05d.png"),
    "-c:v",
    "prores_ks",
    "-profile:v",
    "4444",
    "-pix_fmt",
    "yuva444p10le",
    "-loglevel",
    "error",
    output,
  ])
}

/* -------------------------------------------------------------------------- */
/* Process plumbing                                                            */
/* -------------------------------------------------------------------------- */

interface RunOptions {
  onStdout?: (chunk: string) => void
}

interface RunResult {
  stdout: string
  stderr: string
}

export class CommandError extends Error {
  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly stderr: string
  ) {
    super(
      `${command} exited with ${code ?? "no code"}${stderr ? `: ${stderr.trim()}` : ""}`
    )
    this.name = "CommandError"
  }
}

function run(
  command: string,
  args: string[],
  options: RunOptions = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      options.onStdout?.(text)
    })
    // Keep only the tail. ffmpeg is chatty, and the useful part of a failure is
    // always the last few lines.
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000)
    })

    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "ENOENT"
          ? new Error(
              `\`${command}\` not found on PATH. Install it with \`brew install ffmpeg\`.`
            )
          : error
      )
    })

    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new CommandError(command, code, stderr))
    })
  })
}

/**
 * Reads `-progress pipe:1` output, which arrives as `key=value` lines with
 * `out_time_us` giving the position in microseconds.
 */
function progressReader(
  durationSec: number | undefined,
  onProgress: ((fraction: number) => void) | undefined
) {
  if (!durationSec || !onProgress) return undefined

  let buffer = ""
  return (chunk: string) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const [key, value] = line.split("=")
      if (key !== "out_time_us") continue
      const seconds = Number(value) / 1_000_000
      if (Number.isFinite(seconds)) {
        onProgress(Math.min(1, Math.max(0, seconds / durationSec)))
      }
    }
  }
}
