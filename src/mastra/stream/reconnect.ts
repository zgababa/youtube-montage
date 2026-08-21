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

import {
  GateSchema,
  pipelineDataSchemas,
  RunStatusSchema,
  StepIdSchema,
  StepStatusSchema,
  type PipelineDataParts,
  type PipelineDataType,
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
 * `emitter()`'s guarantee, on the replay side: the key picks the payload type
 * at compile time, and the same schema `emitter()` uses parses it at run time.
 * Throwing is deliberate for the same reason it is there — a malformed chunk
 * is a bug here, and finding it now beats finding it as a blank panel.
 */
function dataChunk<K extends PipelineDataType>(
  type: K,
  data: PipelineDataParts[K],
  id?: string
): ReconnectChunk {
  pipelineDataSchemas[type].parse(data)
  return { type: `data-${type}`, data, ...(id ? { id } : {}) }
}

/**
 * Mastra's status vocabulary is a superset of this app's — narrow it down,
 * against the contract's own enums rather than a second copy of them.
 */
function runStatus(status: string): PipelineDataParts["run"]["status"] {
  const parsed = RunStatusSchema.safeParse(status)
  return parsed.success ? parsed.data : "running"
}

function stepStatus(status: string): PipelineDataParts["step"]["status"] {
  const parsed = StepStatusSchema.safeParse(status)
  return parsed.success ? parsed.data : "pending"
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
 * would have streamed out. `workflowStateToPipelineStream` below wraps this in
 * the `ReadableStream` the route handler responds with.
 */
export function workflowStateToPipelineChunks(
  state: WorkflowStateForReconnect
): ReconnectChunk[] {
  const chunks: ReconnectChunk[] = [{ type: "start" }]

  const fromPayload = state.payload?.projectPath
  const projectPath =
    typeof fromPayload === "string" ? fromPayload : state.resourceId

  if (projectPath) {
    chunks.push(
      dataChunk(
        "run",
        {
          runId: state.runId,
          projectPath,
          status: runStatus(state.status),
          startedAt: state.createdAt.toISOString(),
        },
        `run:${state.runId}`
      )
    )
  }

  let gate: PipelineDataParts["gate"] | null = null

  for (const [id, raw] of Object.entries(state.steps ?? {})) {
    const parsedId = StepIdSchema.safeParse(id)
    if (!parsedId.success) continue // internal/foreach step id — not this app's contract

    const result = latest(raw)
    if (!result) continue

    chunks.push(
      dataChunk(
        "step",
        { id: parsedId.data, status: stepStatus(result.status) },
        `step:${parsedId.data}`
      )
    )

    if (!gate && result.status === "suspended") {
      gate = gateFor(parsedId.data, state.runId, result.suspendPayload)
    }
  }

  if (gate) chunks.push(dataChunk("gate", gate))

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
  const chunks = workflowStateToPipelineChunks(state)
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}
