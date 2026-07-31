/**
 * Types mirroring `project.json` (idea.md §7) plus the run/progress shape the UI
 * renders from Mastra workflow events (idea.md §4.3).
 *
 * These are the contract between the UI and the pipeline. Nothing here is
 * UI-only state — that lives in the components.
 */

export type SpanAction = "keep" | "cut"

export type SpanCategory =
  | "filler"
  | "redundant"
  | "bad_take"
  | "tangent"
  | "false_start"

export type SceneStatus =
  | "pending"
  | "generating"
  | "ready"
  | "approved"
  | "rejected"
  | "exporting"
  | "exported"
  | "failed"

export type SceneType = "diagram" | "code" | "data" | "process" | "concept"

export interface MediaFile {
  path: string
  durationSec: number
  hasAudio: boolean
}

export interface Word {
  w: string
  start: number
  end: number
  file: string
}

export interface Span {
  start: number
  end: number
  action: SpanAction
  reason?: string
  category?: SpanCategory
}

export interface StyleGuide {
  palette: string[]
  fontStack: string
  motion: string
  notes: string
}

export interface Scene {
  id: string
  scriptStart: number
  scriptEnd: number
  windowSec: number
  coversLine: string
  sourceFile: string
  intent: string
  type: SceneType
  status: SceneStatus
  htmlPath: string | null
  exportPath: string | null
  measuredDurationSec: number | null
  /** Read server-side from `htmlPath` and passed as a string — never served as a file. */
  html: string | null
  /** Set when the generation step returned `{ html: null, failed: true }`. */
  error?: string
  /** Note attached to the last regenerate request. */
  note?: string
}

export interface YouTubeCopy {
  title: string[]
  description: string
  chapters: { timecode: string; label: string }[]
  tags: string[]
}

export interface TwitterCopy {
  hook: string
  thread: string[]
  standalone: string
}

export interface ProjectCopy {
  youtube: YouTubeCopy
  twitter: TwitterCopy
}

export interface Project {
  version: 1
  id: string
  path: string
  name: string
  createdAt: string
  fps: number
  media: MediaFile[]
  transcript: { words: Word[] }
  spans: Span[]
  cleanupApprovedAt: string | null
  styleGuide: StyleGuide
  scenes: Scene[]
  copy: ProjectCopy | null
}

/** Row in `~/.videotool/projects.json`, enriched with counts for the grid. */
export interface ProjectSummary {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpened: string
  sceneCount: number
  exportedCount: number
  /** Scene HTML used as the card thumbnail, frozen at its midpoint. */
  thumbnailHtml: string | null
}

/* -------------------------------------------------------------------------- */
/* Run state — derived from `run.stream()` events, not stored in project.json  */
/* -------------------------------------------------------------------------- */

export type StepId =
  | "scan"
  | "extract-audio"
  | "transcribe"
  | "cleanup"
  | "scenarios"
  | "generate"
  | "export"
  | "copy"
  | "shotlist"

export type StepStatus =
  | "pending"
  | "running"
  | "suspended"
  | "success"
  | "failed"

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

export interface Run {
  id: string
  status: "running" | "suspended" | "success" | "failed"
  startedAt: string
  steps: RunStep[]
  /** Which `suspend()` the workflow is parked on, if any. */
  suspendedOn: "review-cleanup" | "review-scenes" | null
}

/** Directory listing from `/api/browse`, for the folder picker. */
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
