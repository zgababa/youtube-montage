/**
 * Derivations over `project.json`.
 *
 * The clean script is a *rendering of the spans marked `keep`* (idea.md §3) —
 * it is computed here every time and never stored. Same for the shot list.
 */

import { durationLabel, timecode } from "@/lib/format"
import { buildCompositeOverlays } from "@/src/mastra/lib/composite"
import { placeOverlays } from "@/src/mastra/lib/fcpxml"
import { buildSegments, keptSegments } from "@/src/mastra/lib/segments"
import type { SceneDecision } from "@/src/mastra/stream/contract"
import type {
  PlanCompositionStatus,
  PlanElementSource,
  PlanElementStatus,
  PlanRenderStatus,
  Project,
  Scene,
  SceneStatus,
  Span,
  SpanCategory,
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
  planElementId?: string
  renderStatus?: PlanRenderStatus
  /**
   * ADR 0006's `Composé`: `"composed"` only once the last actual build of
   * `timeline.fcpxml` (the "Update timeline" action, `writeComposite`)
   * placed this element. Never overridden by a live prediction — see
   * `wouldCompose` for that.
   */
  compositionStatus?: PlanCompositionStatus
  compositionError?: string
  /**
   * Whether this element *would* land in `timeline.fcpxml` if "Update
   * timeline" were clicked right now, against the project's current state.
   *
   * Distinct from `compositionStatus === "composed"` on purpose: exporting a
   * scene doesn't itself rewrite `timeline.fcpxml` (ADR 0009 — that's a
   * separate, cheap, manually-triggered action), so a scene can be freshly
   * exported and already `wouldCompose`, while the file on disk hasn't been
   * rebuilt yet and `compositionStatus` still reads its last, older value.
   */
  wouldCompose: boolean
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
export interface EditingDocumentView {
  /** `null` until the cleanup is approved — there is no approved script yet. */
  script: {
    text: string
    keptSpanCount: number
    segments: { index: number; text: string }[]
  } | null
  entries: EditingDocumentEntry[]
  titles: EditingDocumentTitleEntry[]
  /** The persisted structural layer, exposed through the same document view. */
  sections: Project["editingDocument"]["sections"]
  elements: Project["editingDocument"]["elements"]
  analysisAt: string | null
  reviewedAt: string | null
}

/**
 * A TITRE element as the document shows it: the element itself, the title
 * asset it produced (if rendered), and whether that asset made it into the
 * FCPXML export — the three things ADR 0006 says the document has to link
 * for a title to read as one flow rather than three.
 */
export interface EditingDocumentTitleEntry {
  elementId: string
  fromSegment: number
  scriptStart: number
  source: PlanElementSource
  text: string
  status: PlanElementStatus
  htmlPath: string | null
  exportPath: string | null
  /** ADR 0006's `Composé` — see `EditingDocumentEntry.compositionStatus`. */
  composed: boolean
  /** See `EditingDocumentEntry.wouldCompose`. */
  wouldCompose: boolean
}

/**
 * Which TITRE elements would land in `timeline.fcpxml` if it were rebuilt
 * right now, against the project's current state.
 *
 * Built from the exact same overlays and runs the `overlay` step composites
 * with (`buildCompositeOverlays`) — including the exported scenes competing
 * for the same runs — rather than predicting against a second, partial
 * computation that could silently drift from what a real build would do.
 * This is deliberately a *prediction*: whether a title has actually been
 * composed is `compositionStatus`, last written by an actual build.
 */
function titlesThatWouldCompose(project: Project): Set<string> {
  const titleElements = project.editingDocument.elements.filter(
    (element) => element.type === "title"
  )
  if (titleElements.length === 0) return new Set()

  const { runs, overlays } = buildCompositeOverlays(project)
  if (overlays.length === 0) return new Set()

  const titleIds = new Set(titleElements.map((element) => element.id))
  const { placed } = placeOverlays(runs, overlays)
  return new Set(
    placed.map((fragment) => fragment.sceneId).filter((id) => titleIds.has(id))
  )
}

export function buildEditingDocument(project: Project): EditingDocumentView {
  if (project.cleanupApprovedAt === null) {
    return {
      script: null,
      entries: [],
      titles: [],
      ...project.editingDocument,
    }
  }

  const spans = spansWithText(project.spans, project.transcript.words)
  const kept = spans.filter((span) => span.action === "keep")
  const segments = keptSegments(
    buildSegments(project.transcript.words),
    project.spans
  )
  const segmentStart = new Map(segments.map((s) => [s.index, s.start]))
  const titlesComposable = titlesThatWouldCompose(project)
  const planById = new Map(
    project.editingDocument.elements.map((element) => [element.id, element])
  )
  const { runs, overlays } = buildCompositeOverlays(project)
  const scenesComposable = new Set(
    placeOverlays(runs, overlays).placed.map((fragment) => fragment.sceneId)
  )

  return {
    ...project.editingDocument,
    script: {
      text: cleanScript(spans),
      keptSpanCount: kept.length,
      segments: segments.map((s) => ({ index: s.index, text: s.text })),
    },
    entries: project.scenes
      .slice()
      .sort(byScriptStart)
      .map((scene) => {
        const plan = scene.planElementId
          ? planById.get(scene.planElementId)
          : undefined
        const wouldCompose = scenesComposable.has(scene.id)
        return {
          sceneId: scene.id,
          scriptStart: scene.scriptStart,
          scriptEnd: scene.scriptEnd,
          reason: scene.intent,
          status: scene.status,
          htmlPath:
            plan?.htmlPath === undefined ? scene.htmlPath : plan.htmlPath,
          exportPath:
            plan?.exportPath === undefined ? scene.exportPath : plan.exportPath,
          wouldCompose,
          ...(scene.planElementId
            ? {
                planElementId: scene.planElementId,
                ...(plan?.renderStatus
                  ? { renderStatus: plan.renderStatus }
                  : {}),
                ...(plan?.compositionError
                  ? { compositionError: plan.compositionError }
                  : {}),
                compositionStatus: plan?.compositionStatus ?? "not-composed",
              }
            : {}),
        }
      }),
    titles: project.editingDocument.elements
      .filter((element) => element.type === "title")
      .slice()
      .sort((a, b) => a.fromSegment - b.fromSegment)
      .map((element) => ({
        elementId: element.id,
        fromSegment: element.fromSegment,
        scriptStart: segmentStart.get(element.fromSegment) ?? 0,
        source: element.source,
        text: element.titleText ?? "",
        status: element.status,
        htmlPath: element.htmlPath ?? null,
        exportPath: element.exportPath ?? null,
        composed: element.compositionStatus === "composed",
        wouldCompose: titlesComposable.has(element.id),
      })),
  }
}

/* -------------------------------------------------------------------------- */
/* Theater-script layout — sections with inline markers (issue #5)             */
/* -------------------------------------------------------------------------- */

/** One paragraph of kept script text, or one visual intention at its spot. */
export type DocumentBlock =
  | { kind: "text"; segments: { index: number; text: string }[] }
  | {
      kind: "title"
      id: string
      anchor: number
      source: "manual" | "automatic"
      status: PlanElementStatus
      text: string
      scriptStart: number
      /** ADR 0006's `Composé` — see `EditingDocumentEntry.compositionStatus`. */
      composed: boolean
      /** See `EditingDocumentEntry.wouldCompose`. */
      wouldCompose: boolean
    }
  | {
      kind: "zoom"
      id: string
      anchor: number
      status: PlanElementStatus
      preset?: string
      durationSec?: number
      reason: string
      scriptStart: number
    }
  | {
      kind: "scene"
      id: string
      anchor: number
      status: SceneStatus | PlanElementStatus
      reason: string
      scriptStart: number
      wouldCompose: boolean
      renderStatus?: PlanRenderStatus
      compositionStatus?: PlanCompositionStatus
      /**
       * The plan element behind this block, when there is one to reject.
       * Undefined for a scene already generated and exported — pulling that
       * one out of the document is the Scenes stage's job (it also owns the
       * render/export files), not a quick delete here.
       */
      planElementId?: string
    }

export interface DocumentSection {
  id: string
  name: string
  reason: string
  fromSegment: number
  toSegment: number
  blocks: DocumentBlock[]
}

export interface StructuredEditingDocument {
  sections: DocumentSection[]
  /** Markers whose anchor falls outside every section's segment range. */
  unplaced: DocumentBlock[]
}

type AnchoredBlock = Exclude<DocumentBlock, { kind: "text" }>

/**
 * Groups the approved script and every known visual intention by the
 * sections the structural analysis proposed, so the document reads as a
 * screenplay — title, zoom and scene markers sitting inline where they
 * happen — instead of a text blob followed by flat, disconnected lists.
 *
 * Empty when there is no structural plan yet (`document.sections` is empty,
 * including every project written before issue #5): the card falls back to
 * the flat script + entries + titles view in that case.
 */
export function buildDocumentSections(
  project: Project,
  document: EditingDocumentView
): StructuredEditingDocument {
  if (document.sections.length === 0) return { sections: [], unplaced: [] }

  const segments = keptSegments(
    buildSegments(project.transcript.words),
    project.spans
  )
  const elementById = new Map(document.elements.map((el) => [el.id, el]))

  // A rejected element reads as deleted, not as "toggled off" — it stays in
  // `project.editingDocument` (so a re-analysis doesn't just propose the
  // same thing again), but the document itself stops showing it, the same
  // way a dismissed suggestion should behave.
  const scenesFromEntries: AnchoredBlock[] = document.entries
    .filter((entry) => entry.status !== "rejected")
    .map((entry) => {
      const plan = entry.planElementId
        ? elementById.get(entry.planElementId)
        : undefined
      return {
        kind: "scene",
        id: entry.sceneId,
        anchor: plan?.fromSegment ?? anchorFor(segments, entry.scriptStart),
        status: entry.status,
        reason: entry.reason,
        scriptStart: entry.scriptStart,
        wouldCompose: entry.wouldCompose,
        renderStatus: entry.renderStatus,
        compositionStatus: entry.compositionStatus,
      }
    })

  // Every TITRE element — manual or automatic — is already fully described
  // by `document.titles` (rendered/composed status included), so it's
  // excluded below from `proposedElements` to avoid rendering it twice.
  const titleBlocks: AnchoredBlock[] = document.titles
    .filter((title) => title.status !== "rejected")
    .map((title) => ({
      kind: "title",
      id: title.elementId,
      anchor: title.fromSegment,
      source: title.source === "automatic" ? "automatic" : "manual",
      status: title.status,
      text: title.text,
      scriptStart: title.scriptStart,
      composed: title.composed,
      wouldCompose: title.wouldCompose,
    }))

  // Structural zoom intentions have no renderer yet (issue #5's later
  // phase), and a structural scene not yet generated has no entry — both
  // still belong in the document as proposals, so the reviewer sees exactly
  // what would happen without opening the plan review card.
  const linkedSceneIds = new Set(
    document.entries
      .map((entry) => entry.planElementId)
      .filter((id): id is string => id !== undefined)
  )
  const proposedElements: AnchoredBlock[] = document.elements
    .filter(
      (element) =>
        element.type !== "title" &&
        element.status !== "rejected" &&
        !linkedSceneIds.has(element.id)
    )
    .map((element) => {
      const scriptStart = segments.find(
        (segment) => segment.index === element.fromSegment
      )?.start ?? 0
      if (element.type === "zoom") {
        return {
          kind: "zoom",
          id: element.id,
          anchor: element.fromSegment,
          status: element.status,
          preset: element.zoomPreset,
          durationSec: element.zoomDurationSec,
          reason: element.reason,
          scriptStart,
        }
      }
      return {
        kind: "scene",
        id: element.id,
        anchor: element.fromSegment,
        status: element.status,
        reason: element.intent ?? element.reason,
        scriptStart,
        wouldCompose: false,
        planElementId: element.id,
      }
    })

  const markers = [
    ...scenesFromEntries,
    ...titleBlocks,
    ...proposedElements,
  ].sort((a, b) => a.anchor - b.anchor)

  const sections: DocumentSection[] = document.sections
    .slice()
    .sort((a, b) => a.fromSegment - b.fromSegment)
    .map((section) => ({
      id: section.id,
      name: section.name,
      reason: section.reason,
      fromSegment: section.fromSegment,
      toSegment: section.toSegment,
      blocks: [],
    }))

  const unplaced: DocumentBlock[] = []
  const sectionFor = (anchor: number) =>
    sections.find(
      (section) => anchor >= section.fromSegment && anchor <= section.toSegment
    )

  for (const marker of markers) {
    const section = sectionFor(marker.anchor)
    if (!section) unplaced.push(marker)
  }

  for (const section of sections) {
    const inRange = markers.filter(
      (marker) =>
        marker.anchor >= section.fromSegment &&
        marker.anchor <= section.toSegment
    )
    let markerIndex = 0
    let buffer: { index: number; text: string }[] = []

    const flush = () => {
      if (buffer.length === 0) return
      section.blocks.push({ kind: "text", segments: buffer })
      buffer = []
    }

    for (const segment of segments) {
      if (segment.index < section.fromSegment) continue
      if (segment.index > section.toSegment) break

      while (
        markerIndex < inRange.length &&
        inRange[markerIndex].anchor <= segment.index
      ) {
        flush()
        section.blocks.push(inRange[markerIndex])
        markerIndex += 1
      }

      buffer.push({ index: segment.index, text: segment.text })
    }
    flush()
    while (markerIndex < inRange.length) {
      section.blocks.push(inRange[markerIndex])
      markerIndex += 1
    }
  }

  return { sections, unplaced }
}

/** Falls back to the enclosing segment when a plan element isn't linked. */
function anchorFor(
  segments: ReturnType<typeof keptSegments>,
  scriptStart: number
) {
  const covering = segments.find(
    (segment) => scriptStart >= segment.start && scriptStart < segment.end
  )
  return covering?.index ?? segments[0]?.index ?? 0
}
