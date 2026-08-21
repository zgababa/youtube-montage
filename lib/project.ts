/**
 * Derivations over `project.json`.
 *
 * The clean script is a *rendering of the spans marked `keep`* (idea.md §3) —
 * it is computed here every time and never stored. Same for the shot list.
 */

import { durationLabel, timecode } from "@/lib/format"
import type { SceneDecision } from "@/src/mastra/stream/contract"
import type { Project, Scene, Span, SpanCategory, Word } from "@/lib/types"

export interface SpanText extends Span {
  text: string
  wordCount: number
  /** Position in `project.spans`, so a filtered view can still edit the source. */
  index: number
}

/** Attaches the verbatim words each span covers. No word is ever rewritten. */
export function spansWithText(spans: Span[], words: Word[]): SpanText[] {
  return spans.map((span, index) => {
    const covered = words.filter(
      (word) => word.start >= span.start && word.start < span.end
    )
    return {
      ...span,
      index,
      text: covered.map((word) => word.w).join(" "),
      wordCount: covered.length,
    }
  })
}

/** The clean script: kept spans, concatenated in order. */
export function cleanScript(spans: SpanText[]) {
  return spans
    .filter((span) => span.action === "keep")
    .map((span) => span.text)
    .join(" ")
}

export function cutCounts(spans: Span[]) {
  const counts = new Map<SpanCategory, number>()
  for (const span of spans) {
    if (span.action !== "cut" || !span.category) continue
    counts.set(span.category, (counts.get(span.category) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

export function cutSeconds(spans: Span[]) {
  return spans
    .filter((span) => span.action === "cut")
    .reduce((total, span) => total + (span.end - span.start), 0)
}

export function transcriptSeconds(spans: Span[]) {
  if (spans.length === 0) return 0
  return spans[spans.length - 1].end - spans[0].start
}

/** A scene that animates past its gap is the everyday annoyance (§5). */
export function overrunsWindow(scene: Scene) {
  return (
    scene.measuredDurationSec !== null &&
    scene.measuredDurationSec > scene.windowSec
  )
}

export function sceneCounts(scenes: Scene[]) {
  return {
    total: scenes.length,
    approved: scenes.filter(
      (scene) => scene.status === "approved" || scene.status === "exported"
    ).length,
    exported: scenes.filter((scene) => scene.status === "exported").length,
    failed: scenes.filter((scene) => scene.status === "failed").length,
    overrunning: scenes.filter(overrunsWindow).length,
  }
}

/**
 * The project as it looks with this round's decisions on it.
 *
 * Applied *after* the live run's patch, which is the whole point. `applyPatch`
 * (`lib/run-reducer.ts`) merges the run's scenes by id, but for any scene the
 * run has reported on, its version wins — so a decision held anywhere earlier
 * in the chain is overwritten by the same streamed scene on the next render,
 * and clicking Approve does visibly nothing.
 *
 * The precedence is right as well as necessary. A decision is the user telling
 * the workflow what to do with a scene it has already reported on; until they
 * submit, theirs is the newer fact. Submitting clears them, and the statuses
 * the run reports back take over again.
 */
export function withDecisions(
  project: Project,
  decisions: Record<string, SceneDecision>
): Project {
  if (Object.keys(decisions).length === 0) return project

  return {
    ...project,
    scenes: project.scenes.map((scene) => {
      const decision = decisions[scene.id]
      if (!decision) return scene

      return {
        ...scene,
        status: DECIDED_STATUS[decision.action],
        // Only meaningful for `regenerate`, and only worth showing once the
        // user actually typed one.
        note: decision.note ?? scene.note,
        // Shown as soon as it's picked rather than after the run confirms it,
        // so a scene queued against a different model says so while it waits.
        model: decision.model ?? scene.model,
      }
    }),
  }
}

/** What the card shows between deciding and submitting. */
const DECIDED_STATUS: Record<SceneDecision["action"], Scene["status"]> = {
  approve: "approved",
  reject: "rejected",
  // Not "pending": the workflow regenerates it the moment the review resumes,
  // and the row already knows how to render a scene being written.
  regenerate: "generating",
}

/** The plain-text file that sits on the second monitor during the edit (§11). */
export function shotlistText(project: Project) {
  return project.scenes
    .filter(
      (scene) => scene.status === "approved" || scene.status === "exported"
    )
    .sort((a, b) => a.scriptStart - b.scriptStart)
    .map((scene) => {
      const dur = durationLabel(scene.measuredDurationSec ?? scene.windowSec)
      return `${timecode(scene.scriptStart)}  ${dur}  ${scene.id}.mov  "${scene.coversLine}"`
    })
    .join("\n")
}

export function totalMediaSeconds(project: Project) {
  return project.media.reduce((total, file) => total + file.durationSec, 0)
}
