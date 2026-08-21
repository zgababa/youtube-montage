/**
 * Twelve pipeline steps, as the five things a person actually does.
 *
 * The page used to show progress and the work in two separate places: a panel
 * listing every step, and a row of tabs listing the same phases again under
 * different names. Watching a step finish told you nothing about where to go to
 * act on it, and the two moments the workflow genuinely stops for a human — the
 * cleanup diff and the scene review — were the hardest things on the page to
 * find.
 *
 * A stage is the join. It owns a contiguous run of steps *and* the UI for what
 * those steps produce, so "Cleanup is waiting for you" and the diff you approve
 * are the same object on screen. Everything here is derived from `Project` and
 * `Run` and holds no state, which is what lets the open stage follow the run
 * without anything having to be kept in sync.
 */

import { durationLabel } from "@/lib/format"
import { cutSeconds, sceneCounts } from "@/lib/project"
import { STEP_LABELS } from "@/src/mastra/stream/contract"
import type { Project, Run, RunStep, StepId, StepStatus } from "@/lib/types"

export type StageId =
  | "footage"
  | "cleanup"
  | "timeline"
  | "look"
  | "scenes"
  | "composite"
  | "deliverables"

export interface StageDefinition {
  id: StageId
  label: string
  /** One line on what the stage is for, shown while it's open. */
  blurb: string
  /**
   * The steps it owns, in execution order. Every step belongs to exactly one.
   *
   * Empty for a stage the pipeline doesn't run — the style guide is an input
   * the user sets, not a phase that executes.
   */
  steps: StepId[]
}

/**
 * Declaration order is execution order, and also the order on screen.
 *
 * `export` sits with the scenes rather than in a stage of its own: exporting is
 * what happens to the scenes you approved, and a stage whose entire body is one
 * button is a row you scroll past.
 */
export const STAGES: readonly StageDefinition[] = [
  {
    id: "footage",
    label: "Footage & transcript",
    blurb:
      "What was recorded, which file carries the words, and how the recordings line up.",
    steps: ["scan", "extract-audio", "transcribe"],
  },
  {
    id: "cleanup",
    label: "Transcript cleanup",
    blurb:
      "The clean script is the kept spans. Everything downstream is a rewrite of it.",
    steps: ["cleanup"],
  },
  {
    id: "timeline",
    label: "Timeline export",
    blurb:
      "The cut, exported as FCPXML for DaVinci. Tune the silence cap and regenerate before approving.",
    steps: ["fcpxml"],
  },
  {
    id: "look",
    label: "Style guide",
    blurb:
      "Handed to every scene agent. Without it, scenes generated in parallel don't match. Set before the run rather than produced by it — the house default is in design.md.",
    steps: [],
  },
  {
    id: "scenes",
    label: "Scenes",
    blurb:
      "Placed against the approved script, generated three at a time, exported one at a time.",
    steps: ["scenarios", "generate", "review", "export"],
  },
  {
    id: "composite",
    label: "Timeline composite",
    blurb:
      "The same timeline.fcpxml, rewritten with every exported scene laid in as a connected clip on lane 1. Regenerate to pick up scenes exported since the last pass.",
    steps: ["overlay"],
  },
  {
    id: "deliverables",
    label: "Copy & shot list",
    blurb: "Written from the approved script, so they describe what shipped.",
    steps: ["copy", "shotlist"],
  },
] as const

export interface StageState extends StageDefinition {
  /** Rolled up from the stage's steps — the worst thing happening wins. */
  status: StepStatus
  /** 0–100, from whichever step is working. */
  progress?: number
  /** The working step's detail, or a summary of what the stage holds. */
  detail: string | null
  /** The workflow is suspended here, waiting on a human. */
  needsYou: boolean
  /** Why the body is empty, if it is. Non-null means don't bother opening it. */
  locked: string | null
  /** The steps themselves, for the strip and the log. */
  runSteps: RunStep[]
  log: string[]
}

export function stageStates(project: Project, run: Run | null): StageState[] {
  const reported = new Map(run?.steps.map((step) => [step.id, step]) ?? [])

  return STAGES.map((definition) => {
    const runSteps = definition.steps.map(
      (id): RunStep =>
        reported.get(id) ?? {
          id,
          label: STEP_LABELS[id],
          status: "pending",
          log: [],
        }
    )

    // The one being worked on decides what the header says. A stage of three
    // steps has at most one of them running, since the workflow is sequential
    // within a stage even where it fans out inside a step.
    const working = runSteps.find(
      (step) => step.status === "running" || step.status === "suspended"
    )

    return {
      ...definition,
      status: rollUp(runSteps),
      progress: working?.progress,
      detail: working?.detail ?? summarize(definition.id, project),
      needsYou: runSteps.some((step) => step.status === "suspended"),
      locked: lockReason(definition.id, project),
      runSteps,
      log: runSteps.flatMap((step) => step.log),
    }
  })
}

/**
 * Which stage the page should be showing.
 *
 * In priority order, because these are the reasons a person opened the page:
 * something is waiting on them, something is happening, something broke, or
 * they came back to look at the furthest thing that finished.
 *
 * Never returns a locked stage — a locked stage has nothing in it to show.
 */
export function focusStage(states: StageState[], project: Project): StageId {
  const needsYou = states.find((stage) => stage.needsYou)
  if (needsYou) return needsYou.id

  const running = states.find((stage) => stage.status === "running")
  if (running) return running.id

  const failed = states.find((stage) => stage.status === "failed")
  if (failed) return failed.id

  const filled = states.filter(
    (stage) => stage.locked === null && hasContent(stage.id, project)
  )
  return filled.at(-1)?.id ?? "footage"
}

/** Failure beats a gate beats work in progress beats done. */
function rollUp(steps: RunStep[]): StepStatus {
  // A stage the pipeline never runs has nothing to report, and `every` on an
  // empty list would otherwise call it a success the moment the page loaded.
  if (steps.length === 0) return "pending"
  if (steps.some((step) => step.status === "failed")) return "failed"
  if (steps.some((step) => step.status === "suspended")) return "suspended"
  if (steps.some((step) => step.status === "running")) return "running"
  if (steps.every((step) => step.status === "success")) return "success"
  return "pending"
}

/**
 * What the stage holds, in one line, when nothing in it is running.
 *
 * This is the header's whole job when the run is over: enough to know whether
 * the stage is worth opening without opening it.
 */
function summarize(id: StageId, project: Project): string | null {
  switch (id) {
    case "footage": {
      if (project.media.length === 0) return null
      const files = `${project.media.length} file${project.media.length === 1 ? "" : "s"}`
      const words = project.transcript.words.length
      return words === 0
        ? `${files} · not transcribed`
        : `${files} · ${words.toLocaleString()} words`
    }

    case "cleanup": {
      if (project.spans.length === 0) return null
      const removed = durationLabel(cutSeconds(project.spans))
      return project.cleanupApprovedAt === null
        ? `${removed} proposed for removal`
        : `${removed} removed · approved`
    }

    case "timeline": {
      if (project.spans.length === 0) return null
      const cap = `${project.maxSilenceSec}s silence cap`
      return project.timelineApprovedAt === null
        ? `${cap} · not yet approved`
        : `${cap} · approved`
    }

    case "look":
      return `${project.styleGuide.palette.length} colours · ${project.styleGuide.fontStack.split(",")[0]}`

    case "scenes": {
      const counts = sceneCounts(project.scenes)
      if (counts.total === 0) return null
      const parts = [`${counts.approved} of ${counts.total} approved`]
      if (counts.exported > 0) parts.push(`${counts.exported} exported`)
      if (counts.failed > 0) parts.push(`${counts.failed} failed`)
      return parts.join(" · ")
    }

    case "composite": {
      if (sceneCounts(project.scenes).exported === 0) return null
      return project.compositeApprovedAt === null
        ? "Composited · not yet approved"
        : "Composited · approved"
    }

    case "deliverables":
      return project.copy === null ? null : "YouTube and Twitter copy written"
  }
}

/**
 * Why there is nothing here yet.
 *
 * Locked stages stay in the list rather than being hidden: the ordering is the
 * explanation for why a stage is empty, and a stage that vanishes until it has
 * content can't tell you what it's waiting on. Only ever locked when the body
 * would genuinely be blank — an editable input like the style guide is never
 * locked, because it's something you set *before* the step that reads it.
 */
function lockReason(id: StageId, project: Project): string | null {
  switch (id) {
    case "cleanup":
      return project.spans.length === 0
        ? "Opens once there's a transcript to clean up."
        : null

    case "timeline":
      return project.cleanupApprovedAt === null
        ? "Opens once cleanup is approved."
        : null

    case "scenes":
      return project.timelineApprovedAt === null
        ? "The scenario agent reads the approved script — approve the timeline export first."
        : null

    case "composite":
      return sceneCounts(project.scenes).exported === 0
        ? "Opens once at least one scene has been exported."
        : null

    case "deliverables":
      return project.copy === null && sceneCounts(project.scenes).approved === 0
        ? "Written once scenes have been approved."
        : null

    default:
      return null
  }
}

/**
 * Whether the stage has anything produced in it.
 *
 * Used only to pick the fallback focus, which is why the style guide says no:
 * it always has values, but it's an input the user set, not an output they came
 * back to read.
 */
function hasContent(id: StageId, project: Project): boolean {
  switch (id) {
    case "footage":
      return project.media.length > 0
    case "cleanup":
      return project.spans.length > 0
    case "timeline":
      return project.timelineApprovedAt !== null
    case "look":
      return false
    case "scenes":
      return project.scenes.length > 0
    case "composite":
      return project.compositeApprovedAt !== null
    case "deliverables":
      return project.copy !== null
  }
}
