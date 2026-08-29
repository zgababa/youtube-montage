/**
 * The UI's view of the pipeline's types.
 *
 * Almost nothing is defined here any more. The shapes in `project.json` are
 * declared once as Zod in `src/mastra/schemas.ts` — they have to be, since the
 * workflow steps validate against them — and this file re-exports the inferred
 * types under the names the components already use. One definition, three
 * consumers: step schemas, on-disk validation, and these types.
 *
 * What *is* defined here is run state, which has no on-disk form: it's folded
 * out of the event stream by `lib/run-reducer.ts`, and the folder picker's
 * types, which never leave the app.
 */

import type { Gate, StepId, StepStatus } from "@/src/mastra/stream/contract"

export type {
  EditingDocument,
  EditingPlanElement,
  EditingSection,
  MediaFile,
  Project,
  ProjectCopy,
  ProjectSummary,
  Scene,
  SceneStatus,
  SceneType,
  Span,
  SpanAction,
  SpanCategory,
  StoredProject,
  StoredScene,
  StyleGuide,
  PlanElementSource,
  PlanElementStatus,
  PlanElementType,
  PlanCompositionStatus,
  PlanRenderStatus,
  TranscriptionHints,
  TwitterCopy,
  Word,
  YouTubeCopy,
  ZoomPreset,
  TransitionType,
  SfxType,
} from "@/src/mastra/schemas"

export type {
  Gate,
  RunStatus,
  StepId,
  StepStatus,
} from "@/src/mastra/stream/contract"

/* -------------------------------------------------------------------------- */
/* Run state — folded from the stream, not stored anywhere                      */
/* -------------------------------------------------------------------------- */

export interface RunStep {
  id: StepId
  label: string
  status: StepStatus
  /** 0–100. Absent for steps that can't report fractional progress. */
  progress?: number
  /** Current file or unit of work, shown next to the spinner. */
  detail?: string
  log: string[]
}

/**
 * A scene's document as it is being written, accumulated from the stream.
 *
 * Run state, not project state: it exists between "the model started this
 * scene" and "the scene passed validation", and the finished HTML that
 * supersedes it is the thing that gets stored.
 */
export interface SceneDraft {
  /** Attempt it belongs to. A repair replaces the draft instead of extending it. */
  attempt: number
  html: string
}

export interface Run {
  id: string
  status: "running" | "suspended" | "success" | "failed"
  startedAt: string
  steps: RunStep[]
  /** Which `suspend()` the workflow is parked on, if any. */
  suspendedOn: Gate | null
}

/* -------------------------------------------------------------------------- */
/* Folder picker                                                               */
/* -------------------------------------------------------------------------- */

/** Directory listing from `/api/browse`. */
export interface DirEntry {
  name: string
  path: string
  hasProjectJson: boolean
}

export interface DirListing {
  path: string
  parent: string | null
  entries: DirEntry[]
}
