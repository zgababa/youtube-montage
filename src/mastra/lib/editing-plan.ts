import { z } from "zod"

import type {
  EditingDocument,
  EditingPlanElement,
  EditingSection,
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
  coversLine: z.string().optional(),
  intent: z.string().optional(),
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

export interface ExplicitTitleCommand {
  segmentIndex: number
  text: string
}

/** Parses only paired, reserved envelopes; ordinary mentions stay prose. */
export function parseTitleCommands(
  segments: Array<{ index: number; text: string }>
): ExplicitTitleCommand[] {
  const commands: ExplicitTitleCommand[] = []
  const marker = /\bTITRE\b\s+(.+?)\s+\bTITRE\b/gi

  for (const segment of segments) {
    for (const match of segment.text.matchAll(marker)) {
      const text = match[1]?.trim()
      if (text) commands.push({ segmentIndex: segment.index, text })
    }
  }

  return commands
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
  ])
  for (const candidate of automatic) {
    // An explicit intention owns the location, even when an older automatic
    // suggestion had already been approved. Keep the old item visible as a
    // conflict instead of silently stacking two identities.
    const preserved = byId.get(candidate.id)
    const nextCandidate = preserved ?? candidate
    next.push(withConflict(nextCandidate, next))
  }

  const sections = sectionsAfterAnalysis(current.sections, proposal.sections)
  const sectionIds = new Set(sections.map((section) => section.id))

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
      "coversLine",
      "intent",
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
  if (element.status === "orphaned") return element

  if (element.source === "automatic" && element.status !== "approved") {
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

/** Zoom and B-roll can coexist; titles and duplicate types cannot. */
function incompatible(a: EditingPlanElement, b: EditingPlanElement) {
  if (!rangesOverlap(a, b)) return false
  if (a.type === "zoom" && b.type === "scene") return false
  if (a.type === "scene" && b.type === "zoom") return false
  return a.type === b.type || a.type === "title" || b.type === "title"
}

function byAnchor(a: EditingPlanElement, b: EditingPlanElement) {
  return a.fromSegment - b.fromSegment || a.id.localeCompare(b.id)
}
