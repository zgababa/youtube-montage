/**
 * Checks the things a run needs before it needs them.
 *
 * All four of these fail late and unhelpfully otherwise: a missing ffmpeg
 * surfaces as ENOENT halfway through step 2, a missing API key as a 401 after
 * an hour of transcription. idea.md §14 asks for a clear install message at
 * startup; this produces one.
 */

import { spawn } from "node:child_process"

export interface PreflightIssue {
  what: string
  message: string
}

/** Returns everything that's wrong, not just the first thing. */
export async function preflight(): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = []

  const [hasFfmpeg, hasFfprobe] = await Promise.all([
    onPath("ffmpeg"),
    onPath("ffprobe"),
  ])

  if (!hasFfmpeg || !hasFfprobe) {
    const missing = [!hasFfmpeg && "ffmpeg", !hasFfprobe && "ffprobe"].filter(
      Boolean
    )
    issues.push({
      what: "ffmpeg",
      message: `${missing.join(" and ")} not found on PATH. Install with \`brew install ffmpeg\`.`,
    })
  }

  if (!process.env.OPENROUTER_API_KEY) {
    issues.push({
      what: "OPENROUTER_API_KEY",
      message:
        "OPENROUTER_API_KEY is unset. The cleanup, style, scenario, scene and copy agents all need it. See .env.example.",
    })
  }

  if (!process.env.ASSEMBLYAI_API_KEY) {
    issues.push({
      what: "ASSEMBLYAI_API_KEY",
      message:
        "ASSEMBLYAI_API_KEY is unset. Transcription calls AssemblyAI directly for word-level timestamps. See .env.example.",
    })
  }

  if (!(await hasChromium())) {
    issues.push({
      what: "chromium",
      message:
        "Playwright's Chromium isn't installed. Run `bunx playwright install chromium`. Scene validation and export need it.",
    })
  }

  return issues
}

/** Cheap existence check — `--version` on anything real returns 0 fast. */
function onPath(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ["-version"], { stdio: "ignore" })
    child.on("error", () => resolve(false))
    child.on("close", (code) => resolve(code === 0))
  })
}

/**
 * Resolving the executable path is enough — launching a browser just to check
 * it exists costs a second or two on every run.
 */
async function hasChromium(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright")
    return Boolean(chromium.executablePath())
  } catch {
    return false
  }
}
