/**
 * Step 1 — walk the folder, find media, read durations.
 *
 * Also creates `project.json` when there isn't one, which is what lets the
 * pipeline be pointed at a bare folder of footage with no UI having set
 * anything up first.
 */

import fs from "node:fs/promises"
import path from "node:path"

import { isMediaFile, probe } from "../lib/ffmpeg"
import {
  assignRoles,
  compareForScript,
  describeRoles,
  type ProbedFile,
} from "../lib/media"
import { preflight } from "../lib/preflight"
import {
  blankProject,
  createProject,
  tryReadStoredProject,
  updateProject,
} from "../lib/project"
import type { PipelineWriter } from "../stream/contract"
import { reporter, runStep } from "./shared"

/** Generated output — never inputs. Walking these would find our own exports. */
const SKIP_DIRECTORIES = new Set(["scenes", "exports", "node_modules"])

/**
 * The body of the step, callable on its own.
 *
 * `app/api/pipeline/route.ts` reuses it for the "Scan" action outside the
 * workflow — walking the folder and probing files never suspends and never
 * touches anything but `media`, so there's nothing gained from tying it to a
 * run.
 */
export async function scanProject(
  projectPath: string,
  writer: PipelineWriter | undefined
) {
  const report = reporter("scan", writer)

  return runStep(report, async () => {
    // Checked here rather than at server start because a headless run has no
    // start — and finding out ffmpeg is missing now beats finding out during
    // step 2 with a stack trace.
    const issues = await preflight()
    if (issues.length > 0) {
      throw new Error(issues.map((issue) => issue.message).join("\n"))
    }

    const stats = await fs.stat(projectPath).catch(() => null)
    if (!stats?.isDirectory()) {
      throw new Error(`${projectPath} is not a directory`)
    }

    await report.detail("Looking for media")
    const files = await walk(projectPath)

    if (files.length === 0) {
      throw new Error(
        `No video or audio files under ${projectPath}. Put the footage in the folder (a \`raw/\` subfolder is the convention) and run again.`
      )
    }

    const probed: ProbedFile[] = []
    for (const [index, absolute] of files.entries()) {
      const relative = path.relative(projectPath, absolute)
      await report.progress(index / files.length, relative)
      const { durationSec, hasAudio, hasVideo } = await probe(absolute)
      probed.push({ path: relative, durationSec, hasAudio, hasVideo })
      await report.log(`${relative} — ${durationSec.toFixed(1)}s`)
    }

    // Script order, so the media list reads in the order the recordings will
    // be stitched into one transcript. Previously longest-first, on the
    // theory that the longest file is the A-cam — true for one performance,
    // actively misleading for a talk recorded as numbered segments.
    probed.sort((a, b) => compareForScript(a.path, b.path))

    const existing = await tryReadStoredProject(projectPath)
    // Settings carry forward from whatever's on disk, so re-running scan
    // doesn't discard a sync offset the user measured by hand.
    const media = assignRoles(probed, existing?.media)

    if (existing) {
      await updateProject(projectPath, (project) => ({ ...project, media }))
    } else {
      await createProject(projectPath, blankProject(projectPath, media))
    }

    for (const line of describeRoles(media)) {
      await report.log(line)
    }

    await report.emit("media", {
      files: media,
      totalSec: media.reduce((total, file) => total + file.durationSec, 0),
    })

    return media
  })
}

async function walk(root: string): Promise<string[]> {
  const found: string[] = []

  async function visit(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        await visit(absolute)
      } else if (entry.isFile() && isMediaFile(entry.name)) {
        found.push(absolute)
      }
    }
  }

  await visit(root)
  return found.sort()
}
