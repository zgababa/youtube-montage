/**
 * Step 1 — walk the folder, find media, read durations.
 *
 * Also creates `project.json` when there isn't one, which is what lets the
 * workflow be pointed at a bare folder of footage from Studio or a script
 * (idea.md §13) without the UI having set anything up first.
 */

import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { createStep } from "@mastra/core/workflows"

import { isMediaFile, probe } from "../lib/ffmpeg"
import { assignRoles, describeRoles, type ProbedFile } from "../lib/media"
import { preflight } from "../lib/preflight"
import {
  createProject,
  tryReadStoredProject,
  updateProject,
} from "../lib/project"
import type { MediaFile, StoredProject } from "../schemas"
import { PipelineIO, reporter, runStep } from "./shared"

/** Generated output — never inputs. Walking these would find our own exports. */
const SKIP_DIRECTORIES = new Set(["scenes", "exports", "node_modules"])

const DEFAULT_STYLE_GUIDE = {
  palette: ["#0B0B0F", "#E8E8ED", "#7C5CFF"],
  fontStack: "ui-sans-serif, system-ui, sans-serif",
  motion: "slow, heavy easing, opacity and scale only",
  notes: "dark, high contrast, generous whitespace",
}

export const scanStep = createStep({
  id: "scan",
  description:
    "Find video and audio files in the project folder and probe them",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  execute: async ({ inputData, writer, runId }) => {
    const report = reporter("scan", writer)
    const { projectPath } = inputData

    // The head of the stream. Nothing else knows the run id yet, and the client
    // needs it to resume from a gate later.
    await report.emit(
      "run",
      {
        runId,
        projectPath,
        status: "running",
        startedAt: new Date().toISOString(),
      },
      { id: `run:${runId}` }
    )

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

      // Longest first: it's almost always the A-cam, and scanning it first
      // makes the media list read sensibly.
      probed.sort((a, b) => b.durationSec - a.durationSec)

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

      return { projectPath }
    })
  },
})

function blankProject(projectPath: string, media: MediaFile[]): StoredProject {
  return {
    version: 1,
    id: randomUUID(),
    path: projectPath,
    name: path.basename(projectPath),
    createdAt: new Date().toISOString(),
    // idea.md §6: fps must match the editing timeline or the export judders.
    // 30 is the default; the UI can change it before export.
    fps: 30,
    media,
    transcript: { words: [] },
    spans: [],
    cleanupApprovedAt: null,
    styleGuide: DEFAULT_STYLE_GUIDE,
    scenes: [],
    copy: null,
  }
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
