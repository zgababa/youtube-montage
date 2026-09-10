/**
 * ffmpeg and ffprobe, as promises.
 *
 * Both are expected on PATH (idea.md §14). Source footage is always read-only
 * input: nothing here ever writes back over a file the user shot. What this
 * module writes is a scene's ProRes render, the solid-colour clip it backs
 * onto (`white-backing.ts`), and — since the cut is performed rather than
 * merely described (`docs/adr/0008-…`) — H.264 ranges re-encoded out of the
 * source footage and concatenated into one file (`lib/cut.ts`).
 */

import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

export interface ProbeResult {
  durationSec: number
  hasAudio: boolean
  hasVideo: boolean
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

  const streams = parsed.streams ?? []

  return {
    durationSec: Number(parsed.format?.duration ?? 0),
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    // Asked of ffprobe rather than inferred from the extension: `.mov` and
    // `.mp4` are both perfectly legal containers for audio alone, and a
    // separately-recorded mic track is exactly what this distinguishes.
    hasVideo: streams.some((s) => s.codec_type === "video"),
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
 * than WAV. The file exists to be uploaded once and then deleted, and an hour
 * of 16 kHz mono WAV is roughly 115 MB against about a tenth of that as mp3 —
 * at a bitrate no transcriber notices. That difference is entirely upload time.
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

/* -------------------------------------------------------------------------- */
/* Performing a cut (docs/adr/0008-…)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Re-encodes `[startSec, endSec)` of `input` to `output`, seek-accurate.
 *
 * `-ss`/`-to` before `-i` puts both in the input's own clock — the same domain
 * `TimelineRun.sourceStart`/`sourceEnd` already use — and, combined with
 * re-encoding rather than `-c copy`, ffmpeg decodes forward from the nearest
 * keyframe to land exactly on `startSec` instead of stream-copying from
 * whatever keyframe happens to precede it. A stream copy here would silently
 * re-admit a sliver of footage the cleanup cut.
 *
 * H.264/AAC rather than the ProRes used elsewhere in this file: these ranges
 * are concatenated straight back together and never viewed on their own, so
 * there is no reason to pay ProRes's bitrate for an intermediate.
 *
 * Everything after the codec choice is there to make the pieces *identical in
 * shape*, because the concat that follows is a stream copy:
 *
 *   - `-r fps` forces constant frame rate at the project's own fps, so no
 *     piece carries a variable-frame-rate timeline into the concat.
 *   - `-pix_fmt yuv420p` pins the pixel format a phone or a camera may differ
 *     on.
 *   - `-af aresample=async=1:first_pts=0` starts the audio at the same instant
 *     as the video instead of wherever the source's first audio packet after
 *     `startSec` happens to fall — the per-piece offset that would otherwise
 *     accumulate into audible drift across a cut with dozens of ranges.
 *   - `-video_track_timescale` pins the timescale, which mp4 otherwise derives
 *     from the source and which has to match for a copy to concatenate.
 */
export async function extractRange(
  input: string,
  output: string,
  options: { startSec: number; endSec: number; fps: number }
): Promise<void> {
  const { startSec, endSec, fps } = options
  await fs.mkdir(path.dirname(output), { recursive: true })
  await run("ffmpeg", [
    "-nostdin",
    "-y",
    "-ss",
    String(startSec),
    "-to",
    String(endSec),
    "-i",
    input,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-r",
    String(fps),
    "-pix_fmt",
    "yuv420p",
    "-video_track_timescale",
    "90000",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    // Pinned rather than left as the source's own: the concat demuxer
    // stream-copies (`concatFiles`), which cannot reconcile two files that
    // disagree about sample rate or channel layout — it either refuses or
    // emits a stream that plays at the wrong speed from the first boundary
    // on. Pinning both is what lets a cut span several source files (a
    // numbered multi-take shoot) at all.
    "-ar",
    "48000",
    "-ac",
    "2",
    "-af",
    "aresample=async=1:first_pts=0",
    "-loglevel",
    "error",
    output,
  ])
}

/**
 * Concatenates the files listed in `listFile` (ffmpeg's own concat-demuxer
 * format — see `buildConcatList` in `cut.ts`) into `output`.
 *
 * `-c copy`: every listed file was just produced by `extractRange` with the
 * same codec and container parameters, so there is nothing left to re-encode —
 * a straight stream copy is exact and near-instant regardless of total
 * duration. `-fflags +genpts` with `-avoid_negative_ts make_zero` rewrites
 * each piece's timestamps onto one continuous timeline starting at zero;
 * without them the copied packets keep per-piece timestamps and players read
 * the seams as gaps or as audio running ahead of the picture.
 */
export async function concatFiles(
  listFile: string,
  output: string
): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true })
  await run("ffmpeg", [
    "-nostdin",
    "-y",
    "-fflags",
    "+genpts",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    "-loglevel",
    "error",
    output,
  ])
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

/**
 * A plain solid-colour ProRes clip, synthesized directly by ffmpeg's `color`
 * source — no Chromium, no frame-stepping (`white-backing.ts`).
 *
 * Opaque, so plain 422 HQ rather than 4444: nothing here needs a channel to
 * carry, unlike a scene overlay.
 */
export async function encodeSolidColor(
  output: string,
  options: {
    width: number
    height: number
    fps: number
    durationSec: number
    /** Any ffmpeg `color` source name or `0xRRGGBB` — see the `color` filter docs. */
    color: string
  }
): Promise<void> {
  const { width, height, fps, durationSec, color } = options
  await fs.mkdir(path.dirname(output), { recursive: true })
  await run("ffmpeg", [
    "-nostdin",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${width}x${height}:r=${fps}:d=${durationSec}`,
    "-c:v",
    "prores_ks",
    "-profile:v",
    "3",
    "-pix_fmt",
    "yuv422p10le",
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
