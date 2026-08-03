/**
 * Stream parts in, the shapes the components already take out.
 *
 * The review tabs, the scene list, and the pipeline panel were all written
 * against `Project` and `Run` before any of this existed. Rather than teach
 * them about message parts, this folds the stream back into those two shapes —
 * so wiring the workflow up changed the page's data source and none of its
 * components.
 *
 * Pure and total: it recomputes from the whole part list every render rather
 * than accumulating state, which means a late-arriving reconciliation of an
 * earlier part lands correctly instead of being applied out of order.
 */

import { STEP_IDS, STEP_LABELS } from "@/src/mastra/stream/contract"
import type {
  PipelineDataParts,
  PipelineUIMessage,
} from "@/src/mastra/stream/contract"
import type { Project, Run, RunStep, Scene } from "@/lib/types"

type Part = PipelineUIMessage["parts"][number]

/** Everything a live run tells us, in the components' own vocabulary. */
export interface PipelineState {
  run: Run | null
  /** Fields to overlay onto the project read from disk. */
  patch: Partial<Project>
  /** Set while the workflow is parked at a gate, with what's needed to resume. */
  gate: PipelineDataParts["gate"] | null
}

export const EMPTY_PIPELINE_STATE: PipelineState = {
  run: null,
  patch: {},
  gate: null,
}

export interface ReduceOptions {
  /** Live logs, keyed by step id — they arrive transient, outside `parts`. */
  logs?: Record<string, string[]>
  /** False once the HTTP stream has closed. */
  streaming?: boolean
}

export function reduceParts(
  messages: PipelineUIMessage[],
  { logs = {}, streaming = false }: ReduceOptions = {}
): PipelineState {
  const parts = messages.flatMap((message) => message.parts as Part[])

  let head: PipelineDataParts["run"] | null = null
  let gate: PipelineDataParts["gate"] | null = null

  const steps = new Map<string, PipelineDataParts["step"]>()
  const scenes = new Map<string, Scene>()
  const patch: Partial<Project> = {}

  for (const part of parts) {
    switch (part.type) {
      case "data-run":
        head = part.data
        break

      case "data-step":
        steps.set(part.data.id, part.data)
        break

      case "data-gate":
        gate = part.data
        break

      case "data-media":
        patch.media = part.data.files
        break

      case "data-cleanup":
        patch.spans = part.data.spans
        break

      case "data-scenes":
        for (const scene of part.data.scenes) scenes.set(scene.id, scene)
        break

      case "data-scene": {
        // Merge rather than replace, and treat a null document as "not
        // included" rather than "this scene lost its HTML". `review` reports an
        // approval without re-sending the document it approved — taking that
        // literally blanked the preview of every scene the moment it was
        // approved, which is when you most want to still see it.
        const seen = scenes.get(part.data.id)
        scenes.set(part.data.id, {
          ...seen,
          ...part.data,
          html: part.data.html ?? seen?.html ?? null,
        })
        break
      }

      case "data-copy":
        patch.copy = part.data.copy
        break

      default:
        break
    }
  }

  if (scenes.size > 0) {
    patch.scenes = [...scenes.values()].sort(
      (a, b) => a.scriptStart - b.scriptStart
    )
  }

  // Approval is what the cleanup tab gates on, and it isn't in any single
  // event: the workflow moving past the cleanup gate is the signal.
  if (
    steps.get("cleanup")?.status === "success" &&
    patch.cleanupApprovedAt !== null
  ) {
    patch.cleanupApprovedAt = new Date().toISOString()
  }

  return {
    run: head
      ? toRun(head, steps, gate, logs, streaming, patch.scenes ?? [])
      : null,
    patch,
    gate,
  }
}

function toRun(
  head: PipelineDataParts["run"],
  steps: Map<string, PipelineDataParts["step"]>,
  gate: PipelineDataParts["gate"] | null,
  logs: Record<string, string[]>,
  streaming: boolean,
  scenes: Scene[]
): Run {
  return {
    id: head.runId,
    status: runStatus(steps, gate, streaming),
    startedAt: head.startedAt,
    // Every step is listed from the start, in execution order, so the panel
    // shows the shape of the run rather than growing a row at a time.
    steps: STEP_IDS.map((id): RunStep => {
      const reported = steps.get(id)
      const fanOut = id === "generate" && reported?.status === "running"

      return {
        id,
        label: STEP_LABELS[id],
        status: reported?.status ?? "pending",
        progress: fanOut ? generateProgress(scenes) : reported?.progress,
        detail:
          (fanOut ? generateDetail(scenes) : undefined) ?? reported?.detail,
        log: logs[id] ?? [],
      }
    }),
    suspendedOn: gate?.on ?? null,
  }
}

/**
 * How far the scene fan-out has got, counted from the scenes themselves.
 *
 * The phase can't report a fraction from the server: it's a `.foreach` of
 * independent runs finishing out of order, so no single one of them knows how
 * many of its siblings are done. The client does — every scene reaches it as
 * `data-scene`, reconciled by id — so the count is derived here rather than
 * being threaded through shared state on the way out.
 */
function generateProgress(scenes: Scene[]): number | undefined {
  if (scenes.length === 0) return undefined
  return (settledScenes(scenes) / scenes.length) * 100
}

function generateDetail(scenes: Scene[]): string | undefined {
  if (scenes.length === 0) return undefined
  return `${settledScenes(scenes)} of ${scenes.length} scenes`
}

/** Neither queued nor being written: this scene's generation is over. */
function settledScenes(scenes: Scene[]): number {
  return scenes.filter(
    (scene) => scene.status !== "pending" && scene.status !== "generating"
  ).length
}

/**
 * Where the run actually stands.
 *
 * No single event says "the run is over" — the workflow's last step reports
 * success and then the HTTP stream simply closes. So terminal status is
 * inferred: parked at a gate beats everything, a failed step beats a closed
 * stream, and an open stream means it's still going.
 */
function runStatus(
  steps: Map<string, PipelineDataParts["step"]>,
  gate: PipelineDataParts["gate"] | null,
  streaming: boolean
): Run["status"] {
  const reported = [...steps.values()]

  if (gate && reported.some((step) => step.status === "suspended")) {
    return "suspended"
  }
  if (reported.some((step) => step.status === "failed")) return "failed"
  if (streaming) return "running"
  // The stream closed with nothing suspended and nothing failed. If the last
  // step reported success the run finished; otherwise it was cut off — a
  // closed tab, a restarted server — and is neither running nor done here.
  return steps.get("shotlist")?.status === "success" ? "success" : "failed"
}

/** Merges a live patch onto the project read from disk. */
export function applyPatch(project: Project, patch: Partial<Project>): Project {
  return { ...project, ...patch }
}
