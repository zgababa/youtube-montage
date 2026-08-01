/**
 * What every step has in common.
 *
 * Steps pass only `{ projectPath }` between them. Everything else moves through
 * `project.json`, which is deliberate (idea.md §9): workflow state is for
 * passing values, not for storing results. A step that returned its transcript
 * as step output would have that transcript live in Mastra's database, where a
 * moved project folder loses it.
 */

import { z } from "zod"

import {
  STEP_LABELS,
  emitter,
  type Emit,
  type PipelineWriter,
  type StepId,
} from "../stream/contract"

/** The only thing that flows through the workflow graph. */
export const PipelineIO = z.object({
  projectPath: z.string(),
})

export type PipelineIO = z.infer<typeof PipelineIO>

/**
 * A step's own reporting channel.
 *
 * Every status update reuses the step's id as the chunk id, so the client
 * reconciles them in place rather than accumulating one part per tick.
 */
export interface StepReporter {
  emit: Emit
  start(detail?: string): Promise<void>
  progress(fraction: number, detail?: string): Promise<void>
  detail(detail: string): Promise<void>
  done(): Promise<void>
  suspended(): Promise<void>
  failed(message: string, fatal?: boolean): Promise<void>
  log(line: string): Promise<void>
}

export function reporter(
  id: StepId,
  writer: PipelineWriter | undefined
): StepReporter {
  const emit = emitter(writer)
  const chunk = { id: `step:${id}` }

  return {
    emit,
    start: (detail) => emit("step", { id, status: "running", detail }, chunk),
    progress: (fraction, detail) =>
      emit(
        "step",
        {
          id,
          status: "running",
          progress: Math.round(Math.min(1, Math.max(0, fraction)) * 100),
          detail,
        },
        chunk
      ),
    detail: (detail) => emit("step", { id, status: "running", detail }, chunk),
    done: () => emit("step", { id, status: "success" }, chunk),
    suspended: () => emit("step", { id, status: "suspended" }, chunk),
    async failed(message, fatal = true) {
      await emit("step", { id, status: "failed", detail: message }, chunk)
      await emit("failure", { step: id, message, fatal })
    },
    log: (line) => emit("log", { step: id, line }),
  }
}

export function label(id: StepId) {
  return STEP_LABELS[id]
}

/**
 * Runs a step's body with reporting and failure handling wired up.
 *
 * The rethrow matters: a failed step should still fail the workflow, so Mastra
 * records it and `run.restart()` has something to resume from. This only
 * guarantees the UI hears about it first.
 */
export async function runStep<T>(
  report: StepReporter,
  body: () => Promise<T>
): Promise<T> {
  await report.start()
  try {
    const result = await body()
    await report.done()
    return result
  } catch (error) {
    await report.failed(error instanceof Error ? error.message : String(error))
    throw error
  }
}

export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
