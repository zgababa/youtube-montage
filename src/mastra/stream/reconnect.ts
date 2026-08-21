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
  StepIdSchema,
  type PipelineDataParts,
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

const RUN_STATUSES = new Set<PipelineDataParts["run"]["status"]>([
  "running",
  "suspended",
  "success",
  "failed",
])

const STEP_STATUSES = new Set<PipelineDataParts["step"]["status"]>([
  "pending",
  "running",
  "suspended",
  "success",
  "failed",
])

/** Mastra's status vocabulary is a superset of this app's — narrow it down. */
function runStatus(status: string): PipelineDataParts["run"]["status"] {
  return RUN_STATUSES.has(status as PipelineDataParts["run"]["status"])
    ? (status as PipelineDataParts["run"]["status"])
    : "running"
}

function stepStatus(status: string): PipelineDataParts["step"]["status"] {
  return STEP_STATUSES.has(status as PipelineDataParts["step"]["status"])
    ? (status as PipelineDataParts["step"]["status"])
    : "pending"
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
 * would have streamed out. `src/mastra/stream/reconnect-stream.ts` wraps this
 * in a `ReadableStream` for the route handler.
 */
export function workflowStateToPipelineChunks(
  state: WorkflowStateForReconnect
): ReconnectChunk[] {
  const chunks: ReconnectChunk[] = [{ type: "start" }]

  const projectPath = state.payload?.projectPath
  if (typeof projectPath === "string") {
    const run: PipelineDataParts["run"] = {
      runId: state.runId,
      projectPath,
      status: runStatus(state.status),
      startedAt: state.createdAt.toISOString(),
    }
    pipelineDataSchemas.run.parse(run)
    chunks.push({ type: "data-run", id: `run:${state.runId}`, data: run })
  }

  let gate: PipelineDataParts["gate"] | null = null

  for (const [id, raw] of Object.entries(state.steps ?? {})) {
    const parsedId = StepIdSchema.safeParse(id)
    if (!parsedId.success) continue // internal/foreach step id — not this app's contract

    const result = latest(raw)
    if (!result) continue

    const step: PipelineDataParts["step"] = {
      id: parsedId.data,
      status: stepStatus(result.status),
    }
    pipelineDataSchemas.step.parse(step)
    chunks.push({
      type: "data-step",
      id: `step:${parsedId.data}`,
      data: step,
    })

    if (!gate && result.status === "suspended") {
      gate = gateFor(parsedId.data, state.runId, result.suspendPayload)
    }
  }

  if (gate) {
    pipelineDataSchemas.gate.parse(gate)
    chunks.push({ type: "data-gate", data: gate })
  }

  chunks.push({ type: "finish" })
  return chunks
}
