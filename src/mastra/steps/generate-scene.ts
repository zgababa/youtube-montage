/**
 * One scene: generate, validate, repair, persist.
 *
 * Runs once per scene under `.foreach(..., { concurrency: 3 })`. Two things
 * follow from that:
 *
 *   - **Nothing here is allowed to throw.** In Mastra a single throwing
 *     iteration fails the whole block (idea.md §4.4), and one bad scene must
 *     not kill a run that produced eleven good ones. Failures come back as
 *     `status: "failed"` with the reason attached.
 *   - Scene updates land out of order. Each emits `data-scene` keyed by scene
 *     id so the client reconciles them in place instead of appending.
 */

import { createStep } from "@mastra/core/workflows"
import { z } from "zod"

import { sceneAgent } from "../agents/scene-agent"
import { updateProject, writeSceneHtml } from "../lib/project"
import { validateScene } from "../lib/validate-scene"
import {
  SceneSchema,
  StyleGuideSchema,
  type Scene,
  type StoredScene,
  type StyleGuide,
} from "../schemas"
import { emitter, type PipelineWriter } from "../stream/contract"

/** Generation plus two repairs. A third attempt almost never differs. */
const MAX_ATTEMPTS = 3

export const SceneJobSchema = z.object({
  projectPath: z.string(),
  scene: SceneSchema,
  styleGuide: StyleGuideSchema,
})

export type SceneJob = z.infer<typeof SceneJobSchema>

export const SceneResultSchema = z.object({
  id: z.string(),
  status: SceneSchema.shape.status,
})

export const generateSceneStep = createStep({
  id: "generate-scene",
  description:
    "Generate one scene's HTML, validate it, and repair it if needed",
  inputSchema: SceneJobSchema,
  outputSchema: SceneResultSchema,
  execute: async ({ inputData, writer }) =>
    generateAndPersistScene(inputData, writer as PipelineWriter | undefined),
})

/**
 * The body of the step, callable on its own.
 *
 * Review reuses it: regenerating a rejected scene is the same generate →
 * validate → repair → persist path, just triggered by a human instead of by
 * the foreach.
 */
export async function generateAndPersistScene(
  job: SceneJob,
  writer: PipelineWriter | undefined
): Promise<z.infer<typeof SceneResultSchema>> {
  {
    const { projectPath, scene, styleGuide } = job
    const emit = emitter(writer)
    const publish = (next: Scene) => emit("scene", next, { id: next.id })

    await publish({ ...scene, status: "generating", html: null })

    try {
      const { html, durationSec } = await generateWithRepair(
        scene,
        styleGuide,
        writer
      )

      const htmlPath = await writeSceneHtml(projectPath, scene.id, html)
      const ready: StoredScene = {
        ...scene,
        status: "ready",
        htmlPath,
        measuredDurationSec: durationSec,
        error: undefined,
      }

      await updateProject(projectPath, (project) => ({
        ...project,
        scenes: project.scenes.map((s) => (s.id === scene.id ? ready : s)),
      }))

      await publish({ ...ready, html })
      return { id: scene.id, status: "ready" as const }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const failed: StoredScene = {
        ...scene,
        status: "failed",
        htmlPath: null,
        measuredDurationSec: null,
        error: reason,
      }

      await updateProject(projectPath, (project) => ({
        ...project,
        scenes: project.scenes.map((s) => (s.id === scene.id ? failed : s)),
      }))

      await publish({ ...failed, html: null })
      // Not fatal: the run continues and the other scenes finish.
      await emit("failure", {
        step: "generate",
        message: `${scene.id}: ${reason}`,
        fatal: false,
      })

      return { id: scene.id, status: "failed" as const }
    }
  }
}

async function generateWithRepair(
  scene: StoredScene,
  styleGuide: StyleGuide,
  writer: PipelineWriter | undefined
): Promise<{ html: string; durationSec: number }> {
  const emit = emitter(writer)
  let problems: string[] = []
  let lastHtml: string | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await sceneAgent.generate(
      attempt === 1
        ? briefFor(scene, styleGuide)
        : repairPrompt(briefFor(scene, styleGuide), lastHtml!, problems)
    )

    const html = stripFences(response.text)
    lastHtml = html

    const result = await validateScene(html, scene.windowSec)
    if (result.ok) return { html, durationSec: result.durationSec }

    problems = result.problems
    await emit("log", {
      step: "generate",
      line: `${scene.id} attempt ${attempt}: ${problems[0]}`,
    })
  }

  throw new Error(
    `failed validation after ${MAX_ATTEMPTS} attempts — ${problems.join(" ")}`
  )
}

function briefFor(scene: StoredScene, styleGuide: StyleGuide): string {
  return [
    `Write the scene for this moment in the video.`,
    "",
    `Script line it covers: "${scene.coversLine}"`,
    `Intent: ${scene.intent}`,
    `Scene type: ${scene.type}`,
    `Available window: ${scene.windowSec.toFixed(1)} seconds — the total animation must finish inside this.`,
    ...(scene.note ? ["", `Note from review: ${scene.note}`] : []),
    "",
    "Style guide:",
    `- palette: ${styleGuide.palette.join(", ")}`,
    `- font stack: ${styleGuide.fontStack}`,
    `- motion: ${styleGuide.motion}`,
    `- notes: ${styleGuide.notes}`,
  ].join("\n")
}

/**
 * The previous attempt goes back in with the specific complaints.
 *
 * Sending the HTML rather than starting fresh matters — attempt one is usually
 * right about the composition and wrong about one constraint, and regenerating
 * from scratch throws away the part that worked.
 */
function repairPrompt(brief: string, html: string, problems: string[]): string {
  return [
    brief,
    "",
    "Your previous attempt was rejected. Fix these problems and return the corrected document:",
    "",
    ...problems.map((problem) => `- ${problem}`),
    "",
    "Previous attempt:",
    "",
    html,
  ].join("\n")
}

/**
 * Models wrap HTML in a code fence roughly half the time, whatever the prompt
 * says. Cheaper to strip it than to keep re-rolling for a clean response.
 */
function stripFences(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:html)?\s*\n([\s\S]*?)\n```$/.exec(trimmed)
  return (fenced ? fenced[1] : trimmed).trim()
}
