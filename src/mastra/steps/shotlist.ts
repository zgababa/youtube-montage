/**
 * Step 11 — the plain-text file that sits on the second monitor.
 *
 * The last thing the pipeline produces and, in daily use, the thing that gets
 * looked at most: timecode, duration, filename, and the line the scene covers
 * (idea.md §11). Deliberately not JSON — it's read by a person while editing.
 */

import fs from "node:fs/promises"
import { createStep } from "@mastra/core/workflows"
import { z } from "zod"

import { shotlistPath } from "../lib/paths"
import { readStoredProject } from "../lib/project"
import type { StoredScene } from "../schemas"
import { PipelineIO, reporter, runStep } from "./shared"

export const shotlistStep = createStep({
  id: "shotlist",
  description: "Write shotlist.txt for the exported scenes",
  inputSchema: PipelineIO,
  outputSchema: z.object({
    exported: z.array(z.string()),
  }),
  execute: async ({ inputData, writer }) => {
    const report = reporter("shotlist", writer)
    const { projectPath } = inputData

    return runStep(report, async () => {
      const project = await readStoredProject(projectPath)

      const exported = project.scenes
        .filter((scene) => scene.status === "exported")
        .sort((a, b) => a.scriptStart - b.scriptStart)

      const text = exported.map(line).join("\n")
      const file = shotlistPath(projectPath)
      await fs.writeFile(file, text ? `${text}\n` : "", "utf8")

      await report.emit("shotlist", { path: file, text })
      await report.log(`${exported.length} scenes in the shot list`)

      return {
        exported: exported
          .map((scene) => scene.exportPath)
          .filter((path): path is string => path !== null),
      }
    })
  },
})

function line(scene: StoredScene) {
  const duration = (scene.measuredDurationSec ?? scene.windowSec).toFixed(1)
  return `${timecode(scene.scriptStart)}  ${duration}s  ${scene.id}.mov  "${scene.coversLine}"`
}

function timecode(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
