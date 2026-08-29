/**
 * The one endpoint the pipeline UI talks to.
 *
 * There is no "Run pipeline" — no single workflow run, no suspend/resume, no
 * run id to reconnect to. Each action here is one step's own logic
 * (`src/mastra/steps/*.ts`), called directly and streamed back the same way
 * a Mastra workflow step's own `writer.custom()` would:
 * `createUIMessageStream` is the same AI SDK primitive
 * `handleWorkflowStream` builds on, so the client (`hooks/use-pipeline.ts`,
 * `lib/run-reducer.ts`) reads live progress, scene drafts and step status
 * without ever going through Mastra's workflow engine — only the `data-*`
 * chunks on the stream.
 */

import { createUIMessageStream, createUIMessageStreamResponse } from "ai"
import { z } from "zod"

import { readStoredProject } from "@/src/mastra/lib/project"
import { approveCleanup, proposeCleanup } from "@/src/mastra/steps/cleanup"
import { writeCopy } from "@/src/mastra/steps/copy"
import { exportApprovedScenes } from "@/src/mastra/steps/export"
import {
  generateAndPersistScene,
  SCENE_CONCURRENCY,
} from "@/src/mastra/steps/generate-scene"
import { applySceneDecisions } from "@/src/mastra/steps/review"
import { scanProject } from "@/src/mastra/steps/scan"
import {
  analyzeStructure,
  applyPlanDecisions,
} from "@/src/mastra/steps/scenarios"
import { writeShotlist } from "@/src/mastra/steps/shotlist"
import { exportApprovedTitles } from "@/src/mastra/steps/titles"
import { transcribeProject } from "@/src/mastra/steps/transcribe"
import {
  emitter,
  PipelineActionSchema,
  type PipelineUIMessage,
  type PipelineWriter,
} from "@/src/mastra/stream/contract"

// ffmpeg, Playwright and `fs` all live behind this route (idea.md §9).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The slowest single action (transcription, a batch of scenes) is minutes,
 * not seconds — and the default request timeout would cut the stream long
 * before it finished.
 */
export const maxDuration = 3600

export async function POST(request: Request) {
  const parsed = PipelineActionSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json(
      { error: z.prettifyError(parsed.error) },
      { status: 400 }
    )
  }
  const action = parsed.data

  const stream = createUIMessageStream<PipelineUIMessage>({
    execute: async ({ writer }) => {
      // Mastra's own `handleWorkflowStream` wraps the same raw
      // `UIMessageStreamWriter.write()` in exactly this shape internally —
      // `PipelineWriter` was written against that shape (`shared.ts`), not
      // against Mastra itself, which is what makes reusing it here possible.
      const pipelineWriter: PipelineWriter = {
        custom: async (chunk) => {
          writer.write(chunk as Parameters<typeof writer.write>[0])
        },
      }

      const runId = crypto.randomUUID()
      // Gives the client a `Run` to roll `data-step` chunks up into
      // (`lib/run-reducer.ts`) — the same shape a workflow run's head chunk
      // gave it, just for this one action rather than for a run parked
      // anywhere. Nothing persists it; a reload has nothing to reconnect to,
      // because there's nothing left running once the stream closes.
      await emitter(pipelineWriter)(
        "run",
        {
          runId,
          projectPath: action.projectPath,
          status: "running",
          startedAt: new Date().toISOString(),
        },
        { id: `run:${runId}` }
      )

      try {
        switch (action.kind) {
          case "scan":
            await scanProject(action.projectPath, pipelineWriter)
            break

          case "transcribe":
            await transcribeProject(action.projectPath, pipelineWriter)
            break

          case "propose-cleanup":
            await proposeCleanup(action.projectPath, pipelineWriter)
            break

          case "approve-cleanup":
            await approveCleanup(action.projectPath, action.spans)
            break

          case "analyze-plan":
            await analyzeStructure(action.projectPath, pipelineWriter)
            break

          case "apply-plan":
            await applyPlanDecisions(
              action.projectPath,
              action.elementDecisions,
              action.sectionDecisions,
              action.done,
              pipelineWriter
            )
            break

          case "generate-scenes": {
            const project = await readStoredProject(action.projectPath)
            const pending = project.scenes.filter(
              (scene) => scene.status === "pending"
            )
            for (let i = 0; i < pending.length; i += SCENE_CONCURRENCY) {
              const batch = pending.slice(i, i + SCENE_CONCURRENCY)
              await Promise.all(
                batch.map((scene) =>
                  generateAndPersistScene(
                    {
                      projectPath: action.projectPath,
                      scene,
                      styleGuide: project.styleGuide,
                    },
                    pipelineWriter
                  )
                )
              )
            }
            break
          }

          case "apply-scenes":
            await applySceneDecisions(
              action.projectPath,
              action.decisions,
              pipelineWriter
            )
            break

          case "export-approved":
            // Same reasoning as `titles.ts`: both render whatever's approved
            // and missing its export, and always ran back to back — one
            // action covers both.
            await exportApprovedScenes(action.projectPath, pipelineWriter)
            await exportApprovedTitles(action.projectPath, pipelineWriter)
            break

          case "write-copy":
            await writeCopy(action.projectPath, pipelineWriter)
            break

          case "write-shotlist":
            await writeShotlist(action.projectPath, pipelineWriter)
            break
        }
      } catch {
        // Every step above already reports its own `failure`/`step: failed`
        // chunk before rethrowing — swallowed here so the stream still closes
        // cleanly instead of surfacing as a transport-level error the client
        // has no typed chunk for.
      }
    },
  })

  return createUIMessageStreamResponse({ stream })
}
