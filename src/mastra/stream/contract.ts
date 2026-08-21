/**
 * The one contract between workflow steps and the browser.
 *
 * Mastra's `writer.custom()` is typed `{ type: \`data-${string}\`; data: any }`.
 * AI SDK's `useChat<T>()` narrows `part.data` from a `UIMessage`'s data-part
 * map. Neither knows about the other, so a step could emit `data-scene` with
 * the wrong shape and nothing would complain until a component rendered
 * `undefined`.
 *
 * `pipelineDataSchemas` closes that. One object declares every event the
 * pipeline can emit; `PipelineDataParts` maps it into the shape `UIMessage`
 * wants, keyed by the same names; and `emitter()` keys back into it on the
 * writing side. The `data-${K}` template literal is what makes the two ends
 * line up — the client's `part.type === "data-scene"` narrows `part.data` to
 * exactly the `z.infer` of what the step wrote.
 *
 * The `.parse()` inside `emit` is the runtime backstop for the one hop
 * TypeScript can't see through: a bad shape fails in the step, with a stack
 * trace, rather than silently in the browser.
 */

import { z } from "zod"
import type { UIMessage } from "ai"

import {
  HydratedSceneSchema,
  MediaFileSchema,
  ProjectCopySchema,
  SpanCategorySchema,
  SpanSchema,
  type Span,
} from "../schemas"

/* -------------------------------------------------------------------------- */
/* Run state — derived from the stream, never stored in project.json           */
/* -------------------------------------------------------------------------- */

export const StepIdSchema = z.enum([
  "scan",
  "extract-audio",
  "transcribe",
  "cleanup",
  "fcpxml",
  "scenarios",
  "generate",
  "review",
  "export",
  "overlay",
  "copy",
  "shotlist",
])

export const StepStatusSchema = z.enum([
  "pending",
  "running",
  "suspended",
  "success",
  "failed",
])

export const RunStatusSchema = z.enum([
  "running",
  "suspended",
  "success",
  "failed",
])

/** The places the workflow parks and waits for a human (idea.md §4.2). */
export const GateSchema = z.enum([
  "review-cleanup",
  "review-timeline",
  "review-scenes",
  "review-composite",
])

/** Human-readable labels, so a step id never reaches the UI raw. */
export const STEP_LABELS: Record<z.infer<typeof StepIdSchema>, string> = {
  scan: "Scan folder",
  "extract-audio": "Extract audio",
  transcribe: "Transcribe",
  cleanup: "Cleanup pass",
  fcpxml: "Timeline export",
  scenarios: "Plan scenes",
  generate: "Generate scenes",
  review: "Review scenes",
  export: "Export ProRes",
  overlay: "Composite timeline",
  copy: "Write copy",
  shotlist: "Shot list",
}

/** Declaration order, which is also execution order — the UI renders this. */
export const STEP_IDS = StepIdSchema.options

/* -------------------------------------------------------------------------- */
/* Every event the pipeline can emit                                           */
/* -------------------------------------------------------------------------- */

export const pipelineDataSchemas = {
  /** Once per run, at the top. Reconciled by run id. */
  run: z.object({
    runId: z.string(),
    projectPath: z.string(),
    status: RunStatusSchema,
    startedAt: z.string(),
  }),

  /**
   * Per step, reconciled by step id — the same id overwrites in place, which
   * is what turns the pipeline panel into a live table instead of an
   * append-only log.
   */
  step: z.object({
    id: StepIdSchema,
    status: StepStatusSchema,
    /** 0–100. Absent for steps that can't report a fraction. */
    progress: z.number().optional(),
    /** Current file or unit of work, shown next to the spinner. */
    detail: z.string().optional(),
  }),

  /** High frequency and only interesting live, hence transient. */
  log: z.object({
    step: StepIdSchema,
    line: z.string(),
  }),

  media: z.object({
    files: z.array(MediaFileSchema),
    totalSec: z.number(),
  }),

  transcript: z.object({
    wordCount: z.number(),
    durationSec: z.number(),
    fileCount: z.number(),
  }),

  cleanup: z.object({
    spans: z.array(SpanSchema),
    cutSeconds: z.number(),
    counts: z.array(z.tuple([SpanCategorySchema, z.number()])),
  }),

  /** Scene metadata only — placements decided, nothing generated yet. */
  scenes: z.object({
    scenes: z.array(HydratedSceneSchema),
  }),

  /**
   * One scene, reconciled by scene id. Under `concurrency: 3` twelve scenes
   * move `generating → ready` independently and out of order; reconciliation
   * by id is the only reason that renders correctly.
   */
  scene: HydratedSceneSchema,

  /**
   * A scene's document as the model writes it, in deltas.
   *
   * Transient and lossy on purpose. It exists so a scene that is still being
   * written looks like a scene being written rather than a blank card — the
   * authoritative HTML arrives as `scene` once it has passed validation, and is
   * on disk before the run ends.
   */
  "scene-draft": z.object({
    id: z.string(),
    /** Appended since this scene's last chunk. */
    delta: z.string(),
    /**
     * Which attempt this belongs to. A repair writes a fresh document, so the
     * client starts over rather than concatenating two of them.
     */
    attempt: z.number().int(),
  }),

  /** Transient — frame-level export progress, throttled at the source. */
  export: z.object({
    sceneId: z.string(),
    frame: z.number(),
    totalFrames: z.number(),
  }),

  copy: z.object({
    copy: ProjectCopySchema,
  }),

  shotlist: z.object({
    path: z.string(),
    text: z.string(),
  }),

  /** The cut timeline, written before scene generation starts (issue #1). */
  fcpxml: z.object({
    path: z.string(),
    runsCount: z.number(),
    totalDurationSec: z.number(),
    maxSilenceSec: z.number(),
  }),

  /** The cut timeline, rewritten with exported scenes composited in (`overlay.ts`). */
  composite: z.object({
    path: z.string(),
    placedCount: z.number(),
    /** Scene ids whose `scriptStart` didn't land inside any kept run. */
    skipped: z.array(z.string()),
  }),

  /**
   * The workflow has suspended and is waiting on a human. Carries what the
   * client needs to resume: which run, which step, which gate.
   */
  gate: z.object({
    on: GateSchema,
    runId: z.string(),
    step: StepIdSchema,
  }),

  failure: z.object({
    step: StepIdSchema,
    message: z.string(),
    /** False when the run continues — one bad scene out of twelve. */
    fatal: z.boolean(),
  }),
} as const

export type PipelineDataSchemas = typeof pipelineDataSchemas

export type PipelineDataParts = {
  [K in keyof PipelineDataSchemas]: z.infer<PipelineDataSchemas[K]>
}

/* -------------------------------------------------------------------------- */
/* The client's half — what it can ask the workflow to do                      */
/* -------------------------------------------------------------------------- */

/** One scene's outcome at the review gate (idea.md §10). */
export const SceneDecisionSchema = z.object({
  id: z.string(),
  action: z.enum(["approve", "reject", "regenerate"]),
  /** Fed back into the scene prompt. Only meaningful for `regenerate`. */
  note: z.string().optional(),
  /**
   * Router id to write the scene with. Only meaningful for `regenerate`, and
   * omitted when the reviewer left the selector where it was.
   */
  model: z.string().optional(),
})

export type SceneDecision = z.infer<typeof SceneDecisionSchema>

/**
 * Everything the UI can send, as a closed union.
 *
 * `useChat` is a chat transport, and this isn't a chat — so the action rides
 * on the message's metadata and `prepareSendMessagesRequest` turns it into the
 * body the workflow route expects. Making it a union rather than a loose
 * object means the mapping is exhaustive: a new action can't be added without
 * the transport being taught how to send it.
 */
export type PipelineAction =
  | { kind: "start"; projectPath: string }
  | { kind: "approve-cleanup"; runId: string; spans: Span[] }
  | {
      kind: "review-timeline"
      runId: string
      approved: boolean
      maxSilenceSec: number
    }
  | {
      kind: "review-scenes"
      runId: string
      decisions: SceneDecision[]
      /** False keeps the gate open for another round of regeneration. */
      done: boolean
    }
  | { kind: "review-composite"; runId: string; approved: boolean }
  | { kind: "reconnect"; runId: string }

/** The `useChat` type parameter. Both ends of the stream agree on this. */
export type PipelineUIMessage = UIMessage<PipelineAction, PipelineDataParts>

export type PipelineDataType = keyof PipelineDataParts

/** `"data-scene" | "data-step" | …` — what `part.type` looks like client-side. */
export type PipelinePartType = `data-${PipelineDataType}`

/**
 * Emitted live but never persisted. These are either high-frequency (`export`
 * fires per frame batch) or worthless after the fact (`log`), and persisting
 * them would bloat every stored run for no gain. They reach the client through
 * `onData` only, never `message.parts`.
 */
const TRANSIENT: ReadonlySet<PipelineDataType> = new Set([
  "log",
  "export",
  "scene-draft",
])

/* -------------------------------------------------------------------------- */
/* The writing side                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Structural, not `ToolStream` itself — steps receive a real writer but tests
 * and plain-script runs pass a stub, and `writer` is optional in some contexts.
 */
export interface PipelineWriter {
  custom(chunk: {
    type: `data-${string}`
    data: unknown
    id?: string
    transient?: boolean
  }): Promise<void>
}

export type Emit = <K extends PipelineDataType>(
  type: K,
  data: PipelineDataParts[K],
  options?: { id?: string }
) => Promise<void>

/**
 * Wraps a step's `writer` so emitting is checked at both compile time (the key
 * picks the payload type) and run time (the schema parses it).
 *
 * `writer` is optional because a step invoked outside a stream — from a script,
 * or from Studio's single-step runner — has nowhere to write. Those runs should
 * still work, so a missing writer is a no-op rather than a crash.
 */
export function emitter(writer: PipelineWriter | undefined): Emit {
  return async function emit(type, data, options) {
    // Throwing here is deliberate. A malformed chunk is a bug in the step, and
    // finding it now beats finding it as a blank panel in the browser.
    pipelineDataSchemas[type].parse(data)

    // Not awaiting locks the stream — `WritableStream is locked`.
    await writer?.custom({
      type: `data-${type}`,
      data,
      ...(options?.id ? { id: options.id } : {}),
      ...(TRANSIENT.has(type) ? { transient: true } : {}),
    })
  }
}

export type StepId = z.infer<typeof StepIdSchema>
export type StepStatus = z.infer<typeof StepStatusSchema>
export type RunStatus = z.infer<typeof RunStatusSchema>
export type Gate = z.infer<typeof GateSchema>
