/**
 * Rebuilds this app's own stream contract from a persisted `WorkflowState`.
 *
 * `workflowSnapshotToStream` (`@mastra/ai-sdk`) looks like the obvious tool
 * for reconnecting to a suspended run, but it only replays Mastra's generic
 * step/status skeleton — `data-workflow` and `data-workflow-step` chunks —
 * never the custom `data-*` chunks this app's steps emit via `report.emit`
 * (`data-run`, `data-step`, `data-gate`, `data-cleanup`, ...). Confirmed by
 * reading `convert-snapshot.ts` in `@mastra/ai-sdk`'s bundled output, and by
 * running it against a real suspended run in `~/.videotool/mastra.db`:
 * `chunkTypes` came back as `["start", "data-workflow", "data-workflow-step",
 * ..., "finish"]`, nothing this app's `reduceParts` (`lib/run-reducer.ts`)
 * recognises. So reconnecting synthesizes this app's own chunks instead.
 *
 * What a reconnecting client actually needs, `reduceParts` in hand:
 *   - `data-run`, so `pipeline.run` exists at all — otherwise Approve/Reject
 *     have no run id to resume.
 *   - `data-step` per step Mastra recorded, so the pipeline panel shows the
 *     run's real shape instead of every row pending.
 *   - `data-gate`, so Approve/Regenerate resume the right step — the one
 *     part a reconnecting client cannot get any other way.
 *
 * Everything else a live run emits (`data-cleanup`, `data-scenes`, `data-copy`,
 * ...) is already sitting in `project.json` by the time a step suspends —
 * `getProject` on the server component covers it — so it isn't reconstructed
 * here.
 */

import type { z } from "zod"

import {
  emitter,
  GateSchema,
  RunStatusSchema,
  StepIdSchema,
  StepStatusSchema,
  type PipelineDataParts,
  type PipelineWriter,
} from "./contract"

/**
 * The slice of Mastra's `WorkflowState` this module reads. Structural on
 * purpose — this stays a pure function, testable with plain literals, rather
 * than one that has to construct a real `@mastra/core` `WorkflowState`.
 * A real `WorkflowState` (from `getWorkflowRunById`) satisfies this shape.
 */
export interface WorkflowStateForReconnect {
  runId: string
  status: string
  createdAt: Date
  /**
   * The project path the run was started against — the same value `usePipeline`
   * passes as `resourceId`, which is how `getSuspendedRunId` found this run in
   * the first place. Used as the fallback when the snapshot's payload has no
   * `projectPath`, since without one there is no `data-run` and the UI stays
   * "Idle" — the exact failure this module exists to remove (issue #3).
   */
  resourceId?: string
  payload?: Record<string, unknown> | null
  steps?: Record<
    string,
    WorkflowStepResultForReconnect | WorkflowStepResultForReconnect[]
  >
}

export interface WorkflowStepResultForReconnect {
  status: string
  suspendPayload?: unknown
}

export type ReconnectChunk =
  | { type: "start" }
  | { type: "finish" }
  | {
      type: `data-${string}`
      data: unknown
      id?: string
    }

/**
 * Collects what `emitter()` writes rather than streaming it — reconnecting
 * builds the whole chunk list up front, live steps stream theirs one at a
 * time, but both go through the exact same shaping and schema validation.
 * Two independent hand-rolled encoders would only have to drift once.
 */
function collectingWriter(chunks: ReconnectChunk[]): PipelineWriter {
  return {
    async custom(chunk) {
      chunks.push(chunk as ReconnectChunk)
    },
  }
}

/**
 * Mastra's status vocabulary is a superset of this app's — narrow it down,
 * against the contract's own enums rather than a second copy of them.
 */
function narrow<Schema extends z.ZodType<string>>(
  schema: Schema,
  status: string,
  fallback: z.infer<Schema>
): z.infer<Schema> {
  const parsed = schema.safeParse(status)
  return parsed.success ? parsed.data : fallback
}

/** A `.foreach` step is recorded as one result per iteration — the last one wins. */
function latest(
  result: WorkflowStepResultForReconnect | WorkflowStepResultForReconnect[]
): WorkflowStepResultForReconnect | undefined {
  return Array.isArray(result) ? result.at(-1) : result
}

/** `suspendPayload.reason` is exactly this app's `GateSchema` — validate, don't assume. */
function gateFor(
  stepId: PipelineDataParts["step"]["id"],
  runId: string,
  suspendPayload: unknown
): PipelineDataParts["gate"] | null {
  if (!suspendPayload || typeof suspendPayload !== "object") return null
  const reason = GateSchema.safeParse(
    (suspendPayload as { reason?: unknown }).reason
  )
  if (!reason.success) return null
  return { on: reason.data, runId, step: stepId }
}

/**
 * Pure: a `WorkflowState`-shaped object in, the same chunk shapes a live run
 * would have streamed out — built through the same `emitter()` a live step
 * writes through, just collected into an array instead of streamed one at a
 * time. `workflowStateToPipelineStream` below wraps the result in the
 * `ReadableStream` the route handler responds with.
 */
export async function workflowStateToPipelineChunks(
  state: WorkflowStateForReconnect
): Promise<ReconnectChunk[]> {
  const chunks: ReconnectChunk[] = [{ type: "start" }]
  const emit = emitter(collectingWriter(chunks))

  const fromPayload = state.payload?.projectPath
  const projectPath =
    typeof fromPayload === "string" ? fromPayload : state.resourceId

  if (projectPath) {
    await emit(
      "run",
      {
        runId: state.runId,
        projectPath,
        status: narrow(RunStatusSchema, state.status, "running"),
        startedAt: state.createdAt.toISOString(),
      },
      { id: `run:${state.runId}` }
    )
  }

  let gate: PipelineDataParts["gate"] | null = null

  for (const [id, raw] of Object.entries(state.steps ?? {})) {
    const parsedId = StepIdSchema.safeParse(id)
    if (!parsedId.success) continue // internal/foreach step id — not this app's contract

    const result = latest(raw)
    if (!result) continue

    await emit(
      "step",
      {
        id: parsedId.data,
        status: narrow(StepStatusSchema, result.status, "pending"),
      },
      { id: `step:${parsedId.data}` }
    )

    if (!gate && result.status === "suspended") {
      gate = gateFor(parsedId.data, state.runId, result.suspendPayload)
    }
  }

  if (gate) await emit("gate", gate)

  chunks.push({ type: "finish" })
  return chunks
}

/**
 * The route's half: the same contract `handleWorkflowStream` hands
 * `createUIMessageStreamResponse` for a live run, so `useChat` can't tell a
 * replayed run from a live one.
 */
export function workflowStateToPipelineStream(
  state: WorkflowStateForReconnect
): ReadableStream<ReconnectChunk> {
  return new ReadableStream({
    async start(controller) {
      const chunks = await workflowStateToPipelineChunks(state)
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}
