import { describe, expect, test } from "bun:test"

import { workflowStateToPipelineChunks } from "../src/mastra/stream/reconnect"
import type {
  ReconnectChunk,
  WorkflowStateForReconnect,
} from "../src/mastra/stream/reconnect"

const createdAt = new Date("2026-08-21T00:36:52.316Z")

interface DataChunk {
  type: `data-${string}`
  data: Record<string, unknown>
  id?: string
}

/** Narrows past the `{type:"start"}`/`{type:"finish"}` chunks that carry no data. */
function isDataChunk(chunk: ReconnectChunk): chunk is DataChunk {
  return chunk.type !== "start" && chunk.type !== "finish"
}

function ofType(chunks: ReconnectChunk[], type: string): DataChunk[] {
  return chunks.filter(isDataChunk).filter((chunk) => chunk.type === type)
}

describe("workflowStateToPipelineChunks", () => {
  test("round-trips a run suspended at the cleanup gate", () => {
    const state: WorkflowStateForReconnect = {
      runId: "run-1",
      status: "suspended",
      createdAt,
      payload: { projectPath: "/tmp/project" },
      steps: {
        scan: { status: "success" },
        "extract-audio": { status: "success" },
        transcribe: { status: "success" },
        cleanup: {
          status: "suspended",
          suspendPayload: { reason: "review-cleanup", spans: [] },
        },
      },
    }

    const chunks = workflowStateToPipelineChunks(state)

    expect(chunks[0]).toEqual({ type: "start" })
    expect(chunks.at(-1)).toEqual({ type: "finish" })

    const run = ofType(chunks, "data-run").at(0)
    expect(run).toMatchObject({
      type: "data-run",
      data: {
        runId: "run-1",
        projectPath: "/tmp/project",
        status: "suspended",
        startedAt: createdAt.toISOString(),
      },
    })

    const steps = ofType(chunks, "data-step")
    expect(steps).toHaveLength(4)
    expect(steps.find((s) => s.data.id === "cleanup")?.data).toMatchObject({
      id: "cleanup",
      status: "suspended",
    })
    expect(steps.find((s) => s.data.id === "scan")?.data).toMatchObject({
      id: "scan",
      status: "success",
    })

    const gate = ofType(chunks, "data-gate").at(0)
    expect(gate).toEqual({
      type: "data-gate",
      data: { on: "review-cleanup", runId: "run-1", step: "cleanup" },
    })
  })

  test("skips the run chunk when the payload carries no projectPath", () => {
    const state: WorkflowStateForReconnect = {
      runId: "run-2",
      status: "suspended",
      createdAt,
      payload: {},
      steps: {},
    }

    const chunks = workflowStateToPipelineChunks(state)

    expect(chunks.some((chunk) => chunk.type === "data-run")).toBe(false)
  })

  test("skips step ids this app's contract doesn't know about, rather than throwing", () => {
    const state: WorkflowStateForReconnect = {
      runId: "run-3",
      status: "suspended",
      createdAt,
      payload: { projectPath: "/tmp/project" },
      steps: {
        scan: { status: "success" },
        // A foreach's internal step id — not one of this app's `StepIdSchema`
        // members. Reconnecting must not choke on it.
        "generate-scene-workflow": { status: "success" },
      },
    }

    expect(() => workflowStateToPipelineChunks(state)).not.toThrow()

    const steps = ofType(workflowStateToPipelineChunks(state), "data-step")
    expect(steps).toHaveLength(1)
    expect(steps[0].data.id).toBe("scan")
  })

  test("resolves a foreach step recorded as an array to its last result", () => {
    const state: WorkflowStateForReconnect = {
      runId: "run-4",
      status: "running",
      createdAt,
      payload: { projectPath: "/tmp/project" },
      steps: {
        scan: [{ status: "success" }, { status: "success" }],
      },
    }

    const steps = ofType(workflowStateToPipelineChunks(state), "data-step")
    expect(steps).toHaveLength(1)
    expect(steps[0].data.status).toBe("success")
  })

  test("has no gate when nothing is suspended", () => {
    const state: WorkflowStateForReconnect = {
      runId: "run-5",
      status: "running",
      createdAt,
      payload: { projectPath: "/tmp/project" },
      steps: { scan: { status: "running" } },
    }

    const chunks = workflowStateToPipelineChunks(state)
    expect(chunks.some((chunk) => chunk.type === "data-gate")).toBe(false)
  })
})
