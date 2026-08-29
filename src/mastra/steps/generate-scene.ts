/**
 * One scene: generate, validate, repair, persist.
 *
 * Called `SCENE_CONCURRENCY` at a time by `app/api/pipeline/route.ts`'s
 * "Generate scenes" action. Two things follow from that:
 *
 *   - **Nothing here is allowed to throw.** One bad scene must not cost the
 *     batch the eleven good ones — failures come back as `status: "failed"`
 *     with the reason attached, never a rejected promise.
 *   - Scene updates land out of order. Each emits `data-scene` keyed by scene
 *     id so the client reconciles them in place instead of appending.
 */

import { RequestContext } from "@mastra/core/request-context"
import { z } from "zod"

import {
  sceneAgent,
  SCENE_MODEL_KEY,
  type SceneModelContext,
} from "../agents/scene-agent"
import { updatePlanElementLifecycle } from "../lib/editing-plan"
import { updateProject, writeSceneHtml } from "../lib/project"
import { SCENE_MODEL } from "../models"
import { validateScene } from "../lib/validate-scene"
import {
  SceneSchema,
  StyleGuideSchema,
  type Scene,
  type StoredScene,
  type StyleGuide,
} from "../schemas"
import { emitter, type Emit, type PipelineWriter } from "../stream/contract"

/** Generation plus two repairs. A third attempt almost never differs. */
const MAX_ATTEMPTS = 3

/**
 * Modest on purpose. Three concurrent scene agents stays inside rate limits
 * and keeps three Chromium instances validating at once, which is already as
 * much as a laptop wants to do while the user is editing.
 */
export const SCENE_CONCURRENCY = 3

/**
 * How often a scene reports what it has written so far.
 *
 * A scene document is a couple of hundred tokens per second arriving in chunks
 * of a few characters. Forwarding every one of them would be a chunk on the
 * wire — and a React render — per handful of characters, for three scenes at
 * once. At this interval the preview still reads as typing.
 */
const DRAFT_INTERVAL_MS = 100

/**
 * Characters held back from the draft.
 *
 * The model wraps its answer in a code fence about half the time, and the
 * closing one only shows up at the very end. Never emitting the tail means the
 * fence is never written into the preview — the last few characters cost
 * nothing, because the finished document replaces the draft anyway.
 */
const DRAFT_TAIL = 4

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

/**
 * Generate, validate, repair, persist — one scene.
 *
 * Called three at a time (`SCENE_CONCURRENCY`, `app/api/pipeline/route.ts`)
 * for the "Generate scenes" action, and reused as-is by review to regenerate
 * a single rejected scene.
 */
export async function generateAndPersistScene(
  job: SceneJob,
  writer: PipelineWriter | undefined
): Promise<z.infer<typeof SceneResultSchema>> {
  {
    const { projectPath, scene, styleGuide } = job
    const emit = emitter(writer)
    const publish = (next: Scene) => emit("scene", next, { id: next.id })

    // Resolved here rather than read straight off the scene, so the field
    // stored against the result names a real model even on the first pass,
    // where nobody has chosen one.
    const model = scene.model ?? SCENE_MODEL

    await updateProject(projectPath, (project) => ({
      ...project,
      scenes: project.scenes.map((candidate) =>
        candidate.id === scene.id
          ? { ...candidate, model, status: "generating" as const }
          : candidate
      ),
      editingDocument: scene.planElementId
        ? updatePlanElementLifecycle(
            project.editingDocument,
            scene.planElementId,
            {
              sceneId: scene.id,
              renderStatus: "generating",
              renderError: undefined,
              compositionStatus: "not-composed",
            }
          )
        : project.editingDocument,
    }))
    await publish({ ...scene, model, status: "generating", html: null })

    try {
      const { html, durationSec } = await generateWithRepair(
        scene,
        styleGuide,
        model,
        writer
      )

      const htmlPath = await writeSceneHtml(projectPath, scene.id, html)
      const ready: StoredScene = {
        ...scene,
        model,
        status: "ready",
        htmlPath,
        exportPath: null,
        measuredDurationSec: durationSec,
        error: undefined,
      }

      await updateProject(projectPath, (project) => ({
        ...project,
        scenes: project.scenes.map((s) => (s.id === scene.id ? ready : s)),
        editingDocument: scene.planElementId
          ? updatePlanElementLifecycle(
              project.editingDocument,
              scene.planElementId,
              {
                sceneId: scene.id,
                renderStatus: "rendered",
                renderError: undefined,
                htmlPath,
                exportPath: null,
                compositionStatus: "not-composed",
                compositionError: undefined,
              }
            )
          : project.editingDocument,
      }))

      await publish({ ...ready, html })
      return { id: scene.id, status: "ready" as const }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const failed: StoredScene = {
        ...scene,
        model,
        status: "failed",
        htmlPath: null,
        exportPath: null,
        measuredDurationSec: null,
        error: reason,
      }

      await updateProject(projectPath, (project) => ({
        ...project,
        scenes: project.scenes.map((s) => (s.id === scene.id ? failed : s)),
        editingDocument: scene.planElementId
          ? updatePlanElementLifecycle(
              project.editingDocument,
              scene.planElementId,
              {
                sceneId: scene.id,
                renderStatus: "failed",
                renderError: reason,
                htmlPath: null,
                exportPath: null,
                compositionStatus: "not-composed",
              }
            )
          : project.editingDocument,
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
  model: string,
  writer: PipelineWriter | undefined
): Promise<{ html: string; durationSec: number }> {
  const emit = emitter(writer)
  let problems: string[] = []
  let lastHtml: string | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const html = await writeScene(
      attempt === 1
        ? briefFor(scene, styleGuide)
        : repairPrompt(briefFor(scene, styleGuide), lastHtml!, problems),
      scene.id,
      attempt,
      model,
      emit
    )
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

/**
 * One attempt, streamed rather than generated.
 *
 * The stream is what makes the card show something. A scene takes the better
 * part of a minute to write, and the deltas *are* the document — so the client
 * can put them straight into a frame and let the scene draw itself, instead of
 * spinning on a placeholder until the whole thing lands.
 */
async function writeScene(
  prompt: string,
  sceneId: string,
  attempt: number,
  model: string,
  emit: Emit
): Promise<string> {
  // Per-request, not per-agent: `sceneAgent` resolves its model from this on
  // every call, so two scenes generating concurrently under different models
  // don't have to fight over one agent's configuration.
  const requestContext = new RequestContext<SceneModelContext>([
    [SCENE_MODEL_KEY, model],
  ])
  const response = await sceneAgent.stream(prompt, { requestContext })

  let text = ""
  let sent = 0
  let flushedAt = 0

  for await (const delta of response.textStream) {
    text += delta

    const now = Date.now()
    if (now - flushedAt < DRAFT_INTERVAL_MS) continue

    const body = draftBody(text)
    if (body === null) continue

    const upTo = body.length - DRAFT_TAIL
    if (upTo <= sent) continue

    flushedAt = now
    // Awaited, because concurrent writes lock the stream — but never allowed
    // to take the scene down with it. A dropped chunk costs a frame of the
    // preview, and the finished document arrives on its own path regardless.
    try {
      await emit("scene-draft", {
        id: sceneId,
        attempt,
        delta: body.slice(sent, upTo),
      })
      sent = upTo
    } catch {
      // Reporting failed. The scene did not.
    }
  }

  return stripFences(await response.text)
}

/**
 * The document so far, minus the fence the model may have opened with.
 *
 * `null` until the first line is complete, because that is the point at which
 * the answer is known to be fenced or not. Emitting before then risks putting
 * half of a "```html" into the preview and having no way to take it back —
 * the client writes deltas into an open document, so nothing can be unwritten.
 */
function draftBody(text: string): string | null {
  const trimmed = text.trimStart()
  if (!trimmed.includes("\n")) return null

  const fence = /^```[^\n]*\n/.exec(trimmed)
  return fence ? trimmed.slice(fence[0].length) : trimmed
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
