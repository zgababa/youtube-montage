/**
 * Step 6 — decide where b-roll helps.
 *
 * Produces scene metadata only. Nothing is generated yet, which is the point:
 * placements are cheap to produce and cheap to throw away, and reviewing them
 * before spending a model call per scene is the difference between a wasted
 * minute and a wasted twenty.
 */

import { createStep } from "@mastra/core/workflows"
import { z } from "zod"

import { scenarioAgent } from "../agents/scenario-agent"
import { readStoredProject, updateProject } from "../lib/project"
import { buildSegments, keptSegments, renderSegments } from "../lib/segments"
import { generateStructured } from "../lib/structured"
import { SceneTypeSchema, type StoredScene } from "../schemas"
import { PipelineIO, reporter, runStep } from "./shared"

const PlacementsSchema = z.object({
  scenes: z.array(
    z.object({
      fromSegment: z.number().int(),
      toSegment: z.number().int(),
      coversLine: z.string(),
      intent: z.string(),
      type: SceneTypeSchema,
    })
  ),
})

export const scenariosStep = createStep({
  id: "scenarios",
  description: "Decide where animated scenes help, and what each should show",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  execute: async ({ inputData, writer }) => {
    const report = reporter("scenarios", writer)
    const { projectPath } = inputData

    return runStep(report, async () => {
      const project = await readStoredProject(projectPath)

      if (!project.cleanupApprovedAt) {
        throw new Error(
          "Cleanup hasn't been approved — scene placement must run against the approved script."
        )
      }

      const segments = keptSegments(
        buildSegments(project.transcript.words),
        project.spans
      )
      const byIndex = new Map(
        segments.map((segment) => [segment.index, segment])
      )

      const { scenes: placements } = await generateStructured({
        agent: scenarioAgent,
        schema: PlacementsSchema,
        label: "scenarios",
        prompt: [
          "Here is the approved script as numbered segments. Decide where an animated scene helps.",
          "",
          renderSegments(segments),
        ].join("\n"),
      })

      const scenes = placements
        .map((placement) => toScene(placement, byIndex))
        .filter((scene): scene is StoredScene => scene !== null)
        .sort((a, b) => a.scriptStart - b.scriptStart)
        // Numbered after sorting, so scene_03 is always the third scene in the
        // video. The shot list is read top to bottom while editing, and ids
        // that don't ascend with time make it useless.
        .map((scene, index) => ({
          ...scene,
          id: `scene_${String(index + 1).padStart(2, "0")}`,
        }))

      if (scenes.length === 0) {
        throw new Error(
          "No scene placements survived validation — the agent's segment indices didn't match the script."
        )
      }

      await updateProject(projectPath, (current) => ({ ...current, scenes }))
      await report.emit("scenes", {
        scenes: scenes.map((scene) => ({ ...scene, html: null })),
      })
      await report.log(`${scenes.length} scenes placed`)

      return { projectPath }
    })
  },
})

function toScene(
  placement: z.infer<typeof PlacementsSchema>["scenes"][number],
  byIndex: Map<number, { start: number; end: number; file: string }>
): StoredScene | null {
  const from = byIndex.get(Math.min(placement.fromSegment, placement.toSegment))
  const to = byIndex.get(Math.max(placement.fromSegment, placement.toSegment))

  // A hallucinated index is dropped rather than clamped. Clamping would place
  // a scene over content it wasn't written for, and a silently misplaced scene
  // is worse than a missing one.
  if (!from || !to) return null

  const windowSec = to.end - from.start
  if (windowSec <= 0) return null

  return {
    // Replaced after sorting.
    id: "scene_00",
    scriptStart: from.start,
    scriptEnd: to.end,
    windowSec,
    coversLine: placement.coversLine,
    sourceFile: from.file,
    intent: placement.intent,
    type: placement.type,
    status: "pending",
    htmlPath: null,
    exportPath: null,
    measuredDurationSec: null,
  }
}
