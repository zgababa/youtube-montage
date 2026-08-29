/**
 * Derivations over `project.json`.
 *
 * The clean script is a *rendering of the spans marked `keep`* (idea.md §3) —
 * it is computed here every time and never stored. Same for the shot list.
 */

import { durationLabel, timecode } from "@/lib/format"
import { buildCompositeOverlays } from "@/src/mastra/lib/composite"
import { placeOverlays } from "@/src/mastra/lib/fcpxml"
import type { SceneDecision } from "@/src/mastra/stream/contract"
import type {
  Project,
  Scene,
  SceneStatus,
  Span,
  SpanCategory,
  TitleAnnotation,
  TitleAnnotationStatus,
  Word,
} from "@/lib/types"

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

/** Where a scene lands in the script — the order it's shown in everywhere. */
function byScriptStart(a: Scene, b: Scene) {
  return a.scriptStart - b.scriptStart
}

/** The plain-text file that sits on the second monitor during the edit (§11). */
export function shotlistText(project: Project) {
  return project.scenes
    .filter(
      (scene) => scene.status === "approved" || scene.status === "exported"
    )
    .sort(byScriptStart)
    .map((scene) => {
      const dur = durationLabel(scene.measuredDurationSec ?? scene.windowSec)
      return `${timecode(scene.scriptStart)}  ${dur}  ${scene.id}.mov  "${scene.coversLine}"`
    })
    .join("\n")
}

export function totalMediaSeconds(project: Project) {
  return project.media.reduce((total, file) => total + file.durationSec, 0)
}

/* -------------------------------------------------------------------------- */
/* Editing document (ADR 0006)                                                */
/* -------------------------------------------------------------------------- */

/**
 * A known element already referenced by the document — a rendered scene,
 * pointed at by id rather than carrying its HTML along.
 */
export interface EditingDocumentEntry {
  /** Reference into `project.scenes` — the HTML and export stay where they are. */
  sceneId: string
  scriptStart: number
  scriptEnd: number
  reason: string
  status: SceneStatus
  htmlPath: string | null
  exportPath: string | null
}

/**
 * The editing document, minimal and visible (issue #6).
 *
 * Only the first two layers ADR 0006 describes: the approved script and the
 * elements already known before any structural analysis proposes new ones.
 * Nothing here is stored under its own key in `project.json` — every field it
 * reads (`spans`, `scenes`, `cleanupApprovedAt`) is already persisted there, so
 * this is derived at read time the same way `cleanScript` and `shotlistText`
 * are. That also means a project written before this feature existed needs no
 * migration: with `cleanupApprovedAt` absent or `null`, the document is empty.
 */
export interface EditingDocument {
  /** `null` until the cleanup is approved — there is no approved script yet. */
  script: { text: string; keptSpanCount: number } | null
  entries: EditingDocumentEntry[]
  titles: EditingDocumentTitleEntry[]
}

/**
 * A manual TITRE annotation as the document shows it: the annotation itself,
 * the title asset it produced (if rendered), and whether that asset made it
 * into the FCPXML export — the three things ADR 0006 says the document has
 * to link for a manual annotation to read as one flow rather than three.
 */
export interface EditingDocumentTitleEntry {
  annotationId: string
  segmentIndex: number
  scriptStart: number
  scriptEnd: number
  text: string
  status: TitleAnnotationStatus
  htmlPath: string | null
  exportPath: string | null
  /** `true` only once `timeline.fcpxml` would actually place this asset. */
  composed: boolean
}

/**
 * Which title annotations would actually land in `timeline.fcpxml`.
 *
 * Built from the exact same overlays and runs the `overlay` step composites
 * with (`buildCompositeOverlays`) — including the exported scenes competing
 * for the same runs — rather than placing titles against a second, partial
 * computation that could silently drift from what the step actually writes.
 * "Composed" means what ADR 0006 says it means: referenced by a build of the
 * FCPXML, which is precisely what `placeOverlays` decides.
 */
function composedTitleIds(project: Project): Set<string> {
  if (project.titleAnnotations.length === 0) return new Set()

  const { runs, overlays } = buildCompositeOverlays(project)
  if (overlays.length === 0) return new Set()

  const titleIds = new Set(project.titleAnnotations.map((a) => a.id))
  const { placed } = placeOverlays(runs, overlays)
  return new Set(
    placed
      .map((fragment) => fragment.sceneId)
      .filter((id) => titleIds.has(id))
  )
}

export function buildEditingDocument(project: Project): EditingDocument {
  if (project.cleanupApprovedAt === null) {
    return { script: null, entries: [], titles: [] }
  }

  const spans = spansWithText(project.spans, project.transcript.words)
  const kept = spans.filter((span) => span.action === "keep")
  const composed = composedTitleIds(project)

  return {
    script: { text: cleanScript(spans), keptSpanCount: kept.length },
    entries: project.scenes
      .slice()
      .sort(byScriptStart)
      .map((scene) => ({
        sceneId: scene.id,
        scriptStart: scene.scriptStart,
        scriptEnd: scene.scriptEnd,
        reason: scene.intent,
        status: scene.status,
        htmlPath: scene.htmlPath,
        exportPath: scene.exportPath,
      })),
    titles: project.titleAnnotations
      .slice()
      .sort(
        (a: TitleAnnotation, b: TitleAnnotation) =>
          a.scriptStart - b.scriptStart
      )
      .map((annotation) => ({
        annotationId: annotation.id,
        segmentIndex: annotation.segmentIndex,
        scriptStart: annotation.scriptStart,
        scriptEnd: annotation.scriptEnd,
        text: annotation.text,
        status: annotation.status,
        htmlPath: annotation.htmlPath,
        exportPath: annotation.exportPath,
        composed: composed.has(annotation.id),
      })),
  }
}
