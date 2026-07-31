/**
 * Derivations over `project.json`.
 *
 * The clean script is a *rendering of the spans marked `keep`* (idea.md §3) —
 * it is computed here every time and never stored. Same for the shot list.
 */

import { durationLabel, timecode } from "@/lib/format"
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
