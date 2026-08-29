import { z } from "zod"

import type { Segment } from "./segments"
import { keptSegments } from "./segments"
import type {
  EditingDocument,
  EditingPlanElement,
  EditingSection,
  PlanElementType,
  PlanRenderStatus,
  SceneType,
  Span,
  StoredScene,
  TransitionType,
  ZoomPreset,
} from "../schemas"

/** The validated shape returned by the structural-analysis agent. */
export interface EditingPlanProposal {
  sections: EditingSection[]
  elements: EditingPlanElement[]
}

export const EditingPlanDecisionSchema = z.object({
  id: z.string(),
  action: z.enum(["approve", "reject", "modify"]),
  titleText: z.string().optional(),
  reason: z.string().optional(),
  zoomPreset: z.enum(["subtle", "medium", "strong"]).optional(),
  zoomDurationSec: z.number().positive().optional(),
  zoomPosition: z
    .enum([
      "center",
      "top",
      "bottom",
      "left",
      "right",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ])
    .optional(),
  coversLine: z.string().optional(),
  intent: z.string().optional(),
  transitionType: z
    .enum(["crossfade", "zoom-punch", "dip-to-black"])
    .optional(),
  lowerThirdName: z.string().optional(),
  lowerThirdRole: z.string().optional(),
  titlePosition: z.enum(["center", "lower-third"]).optional(),
})

export type EditingPlanDecision = z.infer<typeof EditingPlanDecisionSchema>

export const EditingSectionDecisionSchema = z.object({
  id: z.string(),
  action: z.enum(["rename", "split", "merge"]),
  name: z.string().optional(),
  splitAtSegment: z.number().int().optional(),
  mergeWithId: z.string().optional(),
})

export type EditingSectionDecision = z.infer<
  typeof EditingSectionDecisionSchema
>

export type PlanElementLifecycleUpdate = Partial<
  Pick<
    EditingPlanElement,
    | "sceneId"
    | "renderStatus"
    | "renderError"
    | "htmlPath"
    | "exportPath"
    | "compositionStatus"
    | "compositionError"
  >
>

/**
 * Updates one renderer's lifecycle without replacing sibling plan elements.
 *
 * Generic across element types — `sceneId` is simply absent on the update for
 * a title or zoom, since nothing has ever generated a `StoredScene` for one.
 */
export function updatePlanElementLifecycle(
  document: EditingDocument,
  planElementId: string,
  update: PlanElementLifecycleUpdate
): EditingDocument {
  return {
    ...document,
    elements: document.elements.map((element) =>
      element.id === planElementId ? { ...element, ...update } : element
    ),
  }
}

/**
 * A scene's status, projected onto the plan element's rendering vocabulary.
 *
 * The one translation both `scenarios.ts` (a scene's status just changed) and
 * `overlay.ts` (reporting what it found before compositing) need — kept here
 * so a future `SceneStatus` value only has one switch to update.
 */
export function sceneRenderStatus(scene: StoredScene): PlanRenderStatus {
  switch (scene.status) {
    case "pending":
      return "pending"
    case "generating":
      return "generating"
    case "ready":
    case "approved":
      return "rendered"
    case "exporting":
      return "exporting"
    case "exported":
      return "exported"
    case "rejected":
      return "rejected"
    case "failed":
      return "failed"
  }
}

/* -------------------------------------------------------------------------- */
/* Manual creation (D2 — select a range in the document, add an element)      */
/* -------------------------------------------------------------------------- */

interface CreatePlanElementInput {
  segments: Segment[]
  spans: Span[]
  sections: EditingSection[]
  fromSegment: number
  toSegment: number
  reason?: string
}

/** The section covering `segmentIndex`, or `""` — surfaced as an orphan by the review UI. */
function coveringSection(
  sections: EditingSection[],
  segmentIndex: number
): string {
  return (
    sections.find(
      (section) =>
        segmentIndex >= section.fromSegment && segmentIndex <= section.toSegment
    )?.id ?? ""
  )
}

/**
 * Refuses two ways, without mutating anything: a segment that doesn't exist,
 * and a segment belonging to a cut span. Generalizes the single-segment
 * check `createTitleAnnotation` used to make to a whole range, since a
 * manually-picked zoom or scene can span more than one segment.
 */
function validateKeptRange(
  segments: Segment[],
  spans: Span[],
  from: number,
  to: number
): void {
  const kept = new Set(keptSegments(segments, spans).map((s) => s.index))
  for (let index = from; index <= to; index++) {
    if (!segments.some((segment) => segment.index === index)) {
      throw new Error(
        `No segment at index ${index} — nothing to anchor the element to.`
      )
    }
    if (!kept.has(index)) {
      throw new Error(
        `Segment ${index} belongs to a cut span. Restore the span before ` +
          "annotating it, or pick a target from the approved script."
      )
    }
  }
}

/** `globalThis.crypto`, not `node:crypto` — these run in the browser too (see `titles.ts`). */
function newPlanElementId(type: PlanElementType): string {
  return `manual_${type}_${globalThis.crypto.randomUUID()}`
}

function basePlanElement(
  type: PlanElementType,
  input: CreatePlanElementInput
): EditingPlanElement {
  validateKeptRange(
    input.segments,
    input.spans,
    input.fromSegment,
    input.toSegment
  )
  return {
    id: newPlanElementId(type),
    sectionId: coveringSection(input.sections, input.fromSegment),
    type,
    source: "manual",
    // A manual element still goes through the same review as an automatic
    // one — deliberate, so a fat-fingered range has a safety net before a
    // scene's real generation cost is spent (see the ADR-adjacent reasoning
    // in the plan this implements: uniform across title/zoom/scene rather
    // than skipping review for the two that are free to render).
    status: "proposed",
    fromSegment: input.fromSegment,
    toSegment: input.toSegment,
    reason: input.reason ?? "Added manually",
  }
}

export function createTitlePlanElement(
  input: CreatePlanElementInput & { titleText: string }
): EditingPlanElement {
  return { ...basePlanElement("title", input), titleText: input.titleText }
}

export function createZoomPlanElement(
  input: CreatePlanElementInput & {
    zoomPreset: ZoomPreset
    zoomDurationSec?: number
  }
): EditingPlanElement {
  return {
    ...basePlanElement("zoom", input),
    zoomPreset: input.zoomPreset,
    zoomDurationSec: input.zoomDurationSec,
  }
}

export function createScenePlanElement(
  input: CreatePlanElementInput & { sceneType?: SceneType; intent?: string }
): EditingPlanElement {
  return {
    ...basePlanElement("scene", input),
    sceneType: input.sceneType,
    intent: input.intent,
  }
}

export function createTransitionPlanElement(
  input: CreatePlanElementInput & {
    transitionType: TransitionType
  }
): EditingPlanElement {
  return {
    ...basePlanElement("transition", input),
    transitionType: input.transitionType,
  }
}

export function createLowerThirdPlanElement(
  input: CreatePlanElementInput & {
    lowerThirdName: string
    lowerThirdRole?: string
  }
): EditingPlanElement {
  return {
    ...basePlanElement("lower-third", input),
    lowerThirdName: input.lowerThirdName,
    lowerThirdRole: input.lowerThirdRole,
    titleText: input.lowerThirdRole
      ? `${input.lowerThirdName} | ${input.lowerThirdRole}`
      : input.lowerThirdName,
  }
}

export type PlanElementDecision =
  | { action: "approve" }
  | { action: "reject" }
  | { action: "modify"; titleText?: string; reason?: string }

/**
 * Approves, rejects or edits one element, client-side, without a live
 * workflow run.
 *
 * `applyEditingPlanDecisions` below is the batch review after an automatic
 * structural analysis, and only runs as part of resuming the `scenarios`
 * workflow step — it needs a run currently suspended at `review-plan`. A
 * manually-added element must stay decidable any time (the same way titles
 * always could before this module unified them with scenes/zooms), so this
 * is a pure mutation the client applies directly and persists via a PATCH,
 * never through the workflow.
 */
export function decidePlanElement(
  element: EditingPlanElement,
  decision: PlanElementDecision
): EditingPlanElement {
  switch (decision.action) {
    case "approve":
      return { ...element, status: "approved" }
    case "reject":
      return { ...element, status: "rejected" }
    case "modify":
      return {
        ...element,
        ...(decision.titleText !== undefined
          ? { titleText: decision.titleText }
          : {}),
        ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
        // Edited copy invalidates whatever was already rendered — same rule
        // `decideTitleAnnotation` used to enforce for TitleAnnotation.
        htmlPath: null,
        exportPath: null,
      }
  }
}

/**
 * Which decisions submitting the plan review actually sends, given what the
 * reviewer has clicked so far.
 *
 * An `orphaned` element has nothing to decide until the next analysis
 * re-anchors or drops it. A `conflict` element only produces a decision once
 * the reviewer explicitly acted on it — otherwise a click on one side of a
 * conflict would silently never reach the server. Every other element sends
 * its drafted decision, or an implicit `reject` if a previous review already
 * rejected it and nothing overrides that, or an implicit `approve` otherwise
 * — approving is what "submit the plan" means for anything left untouched.
 */
export function resolvePlanReviewDecisions(
  elements: EditingPlanElement[],
  drafted: Record<string, EditingPlanDecision>
): EditingPlanDecision[] {
  return elements
    .filter((element) => {
      if (element.status === "orphaned") return false
      if (element.status === "conflict") return drafted[element.id] !== undefined
      return true
    })
    .map((element): EditingPlanDecision => {
      const decision = drafted[element.id]
      if (decision?.action === "reject") return decision
      if (!decision && element.status === "rejected") {
        return { id: element.id, action: "reject" }
      }
      return { ...decision, id: element.id, action: "approve" }
    })
}

/**
 * Keeps renderer/composition fields server-authoritative on a client PATCH.
 *
 * The client never renders or composites anything itself, so trusting the
 * fields a workflow step writes (`sceneId`, `renderStatus`, `htmlPath`,
 * `exportPath`, `compositionStatus`, `compositionError`) would silently erase
 * them the instant a step writes something the client's stale copy doesn't
 * have yet. Re-attaching what's on disk avoids that — `sections` carries none
 * of these fields, so only `elements` needs this.
 *
 * One exception, inherited from the old TITRE-annotation flow: a render
 * belongs to the copy it was rendered from. If an element's `titleText`
 * changed, the .mov on disk shows the old wording, so `htmlPath`/
 * `exportPath` are dropped rather than re-attached — which is exactly what
 * makes the `titles` step pick it up again on the next run (it only renders
 * where `exportPath` is `null`).
 */
export function reconcileRenderedFields(
  incoming: EditingDocument,
  onDisk: EditingDocument
): EditingDocument {
  const byId = new Map(onDisk.elements.map((element) => [element.id, element]))
  return {
    ...incoming,
    elements: incoming.elements.map((element): EditingPlanElement => {
      const stored = byId.get(element.id)
      if (!stored) return element

      const sameCopy = stored.titleText === element.titleText
      return {
        ...element,
        sceneId: stored.sceneId,
        renderStatus: stored.renderStatus,
        renderError: stored.renderError,
        compositionStatus: stored.compositionStatus,
        compositionError: stored.compositionError,
        htmlPath: sameCopy ? stored.htmlPath : null,
        exportPath: sameCopy ? stored.exportPath : null,
      }
    }),
  }
}

/**
 * Merge a fresh automatic analysis into the current document.
 *
 * The document is deliberately current state rather than event history. The
 * merge nevertheless protects the decisions that must survive a rerun:
 * explicit intentions and automatic elements already approved by the creator.
 * Pending automatic suggestions are recalculated from the new proposal.
 */
export function mergeEditingPlan(
  current: EditingDocument,
  proposal: EditingPlanProposal,
  keptSegmentIndexes: Set<number>
): EditingDocument {
  const sections = sectionsAfterAnalysis(current.sections, proposal.sections)
  const sectionIds = new Set(sections.map((section) => section.id))

  const protectedElements = current.elements
    .filter(isProtected)
    .map((element) => orphanIfNeeded(element, keptSegmentIndexes))

  const byId = new Map(
    protectedElements.map((element) => [element.id, element])
  )
  const explicit = dedupeById([
    ...protectedElements.filter((element) => element.source !== "automatic"),
    ...proposal.elements.filter((element) => element.source !== "automatic"),
  ])
  const next: EditingPlanElement[] = []

  for (const candidate of explicit) {
    next.push(withConflict(candidate, next))
  }

  const automatic = dedupeById([
    ...protectedElements.filter((element) => element.source === "automatic"),
    ...proposal.elements.filter((element) => element.source === "automatic"),
    ...sectionStartZooms(sections),
  ])
  for (const candidate of automatic) {
    // An explicit intention owns the location, even when an older automatic
    // suggestion had already been approved. Keep the old item visible as a
    // conflict instead of silently stacking two identities.
    const preserved = byId.get(candidate.id)
    const nextCandidate = preserved ?? candidate
    next.push(withConflict(nextCandidate, next))
  }

  const normalized: EditingPlanElement[] = next.map((element) => {
    if (sectionIds.has(element.sectionId) || element.status === "orphaned") {
      return element
    }
    return element.source === "automatic"
      ? { ...element, status: "conflict" }
      : { ...element, status: "orphaned" }
  })

  return {
    ...current,
    // Sections are cheap model output. Manual sections are kept, while the
    // automatic outline is replaced so a new analysis can improve it.
    sections,
    elements: normalized.sort(byAnchor),
  }
}

/** Stable across reruns, so a reviewed decision on it survives a fresh analysis. */
function sectionStartZoomId(sectionId: string): string {
  return `section_zoom_${sectionId}`
}

/**
 * One automatic zoom per section, anchored to its opening segment.
 *
 * This is deterministic rather than left to the structural agent — "zoom in
 * as each section begins" is a mechanical editing rule, not a judgement call,
 * and asking a model to remember it on every single section is exactly the
 * kind of thing that's reliable on the first nine and silently missing on the
 * tenth. The id is derived from the section id alone, so it's stable across
 * reruns and carries an approve/reject/edit decision forward the same way any
 * other protected automatic element does.
 */
function sectionStartZooms(sections: EditingSection[]): EditingPlanElement[] {
  return sections.map((section) => ({
    id: sectionStartZoomId(section.id),
    sectionId: section.id,
    type: "zoom",
    source: "automatic",
    status: "proposed",
    fromSegment: section.fromSegment,
    toSegment: section.fromSegment,
    reason: "Zoom automatique en début de section",
    zoomPreset: "medium",
  }))
}

function sectionsAfterAnalysis(
  current: EditingSection[],
  proposed: EditingSection[]
) {
  const manual = current.filter((section) => section.source === "manual")
  const manualIds = new Set(manual.map((section) => section.id))
  return [
    ...manual,
    ...proposed.filter((section) => !manualIds.has(section.id)),
  ]
}

/** Applies only the human review actions; rendering consumes the result later. */
export function applyEditingPlanDecisions(
  current: EditingDocument,
  elementDecisions: EditingPlanDecision[],
  sectionDecisions: EditingSectionDecision[]
): EditingDocument {
  const decisions = new Map(
    elementDecisions.map((decision) => [decision.id, decision])
  )
  const elements = current.elements.map((element) => {
    const decision = decisions.get(element.id)
    if (!decision) return element

    const next = { ...element }
    if (decision.action === "approve") next.status = "approved"
    if (decision.action === "reject") next.status = "rejected"
    for (const key of [
      "titleText",
      "reason",
      "zoomPreset",
      "zoomDurationSec",
      "zoomPosition",
      "coversLine",
      "intent",
      "transitionType",
      "lowerThirdName",
      "lowerThirdRole",
      "titlePosition",
    ] as const) {
      const value = decision[key]
      if (value !== undefined) next[key] = value as never
    }
    return next
  })

  let sections = current.sections.map((section) => ({ ...section }))
  let attached = elements

  for (const decision of sectionDecisions) {
    const target = sections.find((section) => section.id === decision.id)
    if (!target) continue

    if (decision.action === "rename") {
      if (decision.name?.trim()) target.name = decision.name.trim()
      target.source = "manual"
      continue
    }

    if (decision.action === "split") {
      const splitAt = decision.splitAtSegment
      if (
        splitAt === undefined ||
        splitAt <= target.fromSegment ||
        splitAt > target.toSegment
      ) {
        continue
      }

      const secondId = `${target.id}-split`
      const originalEnd = target.toSegment
      target.toSegment = splitAt - 1
      target.name = decision.name?.trim() || target.name
      target.source = "manual"
      sections.splice(sections.indexOf(target) + 1, 0, {
        ...target,
        id: secondId,
        fromSegment: splitAt,
        toSegment: originalEnd,
        name: `${target.name} (continued)`,
      })
      attached = attached.map((element) =>
        element.sectionId === target.id && element.fromSegment >= splitAt
          ? { ...element, sectionId: secondId }
          : element
      )
      continue
    }

    const other = sections.find(
      (section) => section.id === decision.mergeWithId
    )
    if (!other || other.id === target.id) continue

    target.fromSegment = Math.min(target.fromSegment, other.fromSegment)
    target.toSegment = Math.max(target.toSegment, other.toSegment)
    target.name = decision.name?.trim() || target.name
    target.source = "manual"
    sections = sections.filter((section) => section.id !== other.id)
    attached = attached.map((element) =>
      element.sectionId === other.id
        ? { ...element, sectionId: target.id }
        : element
    )
  }

  return { ...current, sections, elements: attached }
}

function isProtected(element: EditingPlanElement) {
  return element.source !== "automatic" || element.status === "approved"
}

function orphanIfNeeded(
  element: EditingPlanElement,
  keptSegmentIndexes: Set<number>
): EditingPlanElement {
  if (element.source === "automatic" || element.status === "orphaned") {
    return element
  }

  const anchored =
    keptSegmentIndexes.has(element.fromSegment) &&
    keptSegmentIndexes.has(element.toSegment)
  return anchored ? element : { ...element, status: "orphaned" }
}

function rangesOverlap(a: EditingPlanElement, b: EditingPlanElement) {
  return (
    Math.max(a.fromSegment, b.fromSegment) <= Math.min(a.toSegment, b.toSegment)
  )
}

function dedupeById(elements: EditingPlanElement[]) {
  const seen = new Set<string>()
  return elements.filter((element) => {
    if (seen.has(element.id)) return false
    seen.add(element.id)
    return true
  })
}

function withConflict(
  candidate: EditingPlanElement,
  existing: EditingPlanElement[]
) {
  const conflict = existing.some(
    (element) => isActive(element) && incompatible(element, candidate)
  )
  return conflict ? { ...candidate, status: "conflict" as const } : candidate
}

function isActive(element: EditingPlanElement) {
  return !["rejected", "conflict", "orphaned"].includes(element.status)
}

/** Zoom and B-roll can coexist; titles, lower-thirds, and duplicate types cannot. */
function incompatible(a: EditingPlanElement, b: EditingPlanElement) {
  if (!rangesOverlap(a, b)) return false
  if (a.type === "zoom" && b.type === "scene") return false
  if (a.type === "scene" && b.type === "zoom") return false
  if (a.type === "transition" || b.type === "transition") return false
  return (
    a.type === b.type ||
    a.type === "title" ||
    b.type === "title" ||
    a.type === "lower-third" ||
    b.type === "lower-third"
  )
}

function byAnchor(a: EditingPlanElement, b: EditingPlanElement) {
  return a.fromSegment - b.fromSegment || a.id.localeCompare(b.id)
}
