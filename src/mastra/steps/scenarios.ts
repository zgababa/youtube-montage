/**
 * Structural analysis and plan review.
 *
 * This step owns the first visual decision gate. It writes the proposed plan,
 * suspends before any renderer runs, and only materialises accepted B-roll
 * elements as scene jobs after the creator approves the plan.
 */

import { z } from "zod"

import { structuralAgent } from "../agents/structural-agent"
import {
  applyEditingPlanDecisions,
  mergeEditingPlan,
  sceneRenderStatus,
  updatePlanElementLifecycle,
  type EditingPlanDecision,
  type EditingPlanProposal,
  type EditingSectionDecision,
} from "../lib/editing-plan"
import { readStoredProject, updateProject } from "../lib/project"
import { buildSegments, keptSegments, renderSegments } from "../lib/segments"
import {
  PlanElementTypeSchema,
  SceneTypeSchema,
  ZoomPresetSchema,
  type EditingDocument,
  type EditingPlanElement,
  type EditingSection,
  type StoredScene,
} from "../schemas"
import { generateStructured } from "../lib/structured"
import type { PipelineWriter } from "../stream/contract"
import { message, reporter } from "./shared"

const AnalysisSchema = z.object({
  sections: z.array(
    z.object({
      fromSegment: z.number().int(),
      toSegment: z.number().int(),
      name: z.string(),
      reason: z.string(),
    })
  ),
  elements: z.array(
    z.object({
      section: z.number().int(),
      fromSegment: z.number().int(),
      toSegment: z.number().int(),
      type: PlanElementTypeSchema,
      reason: z.string(),
      confidence: z.number().min(0).max(1).optional(),
      titleText: z.string().optional(),
      zoomPreset: ZoomPresetSchema.optional(),
      zoomDurationSec: z.number().positive().optional(),
      coversLine: z.string().optional(),
      intent: z.string().optional(),
      sceneType: SceneTypeSchema.optional(),
      lowerThirdName: z.string().optional(),
      lowerThirdRole: z.string().optional(),
    })
  ),
})

/**
 * The first pass. `app/api/pipeline/route.ts` calls this for the "Analyze
 * structure" action.
 */
export async function analyzeStructure(
  projectPath: string,
  writer: PipelineWriter | undefined
): Promise<EditingDocument> {
  const report = reporter("scenarios", writer)
  await report.start()

  try {
    const project = await readStoredProject(projectPath)

    if (!project.cleanupApprovedAt) {
      throw new Error(
        "Cleanup hasn't been approved — structural analysis must run against the approved script."
      )
    }

    const segments = keptSegments(
      buildSegments(project.transcript.words),
      project.spans
    )

    const proposal = await analyse(segments, project.sourceScript)
    const merged = mergeEditingPlan(
      project.editingDocument,
      { sections: proposal.sections, elements: proposal.elements },
      new Set(segments.map((segment) => segment.index))
    )
    const document = {
      ...merged,
      analysisAt: new Date().toISOString(),
      reviewedAt: null,
    }

    await updateProject(projectPath, (current) => ({
      ...current,
      editingDocument: document,
    }))
    await report.emit("document", { document })
    await report.done()
    return document
  } catch (error) {
    await report.failed(message(error))
    throw error
  }
}

/**
 * Apply plan decisions, callable on its own — a direct write, not a workflow
 * resume. `done` still decides whether accepted `scene` elements materialise
 * into `project.scenes`: reviewing is not the same as finishing, and nothing
 * downstream should see a scene job for an element still under discussion.
 *
 * `app/api/pipeline/route.ts` reuses it for the "Approve plan" action.
 */
export async function applyPlanDecisions(
  projectPath: string,
  elementDecisions: EditingPlanDecision[],
  sectionDecisions: EditingSectionDecision[],
  done: boolean,
  writer: PipelineWriter | undefined
): Promise<EditingDocument> {
  const report = reporter("scenarios", writer)
  const project = await readStoredProject(projectPath)

  const reviewed = applyEditingPlanDecisions(
    project.editingDocument,
    elementDecisions,
    sectionDecisions
  )
  const document: EditingDocument = {
    ...reviewed,
    reviewedAt: done ? new Date().toISOString() : reviewed.reviewedAt,
  }

  await updateProject(projectPath, (current) => {
    const materialized = done
      ? materializeScenes(current, document)
      : { scenes: current.scenes, document }

    return {
      ...current,
      editingDocument: materialized.document,
      scenes: materialized.scenes,
    }
  })

  const persisted = await readStoredProject(projectPath)
  await report.emit("document", { document: persisted.editingDocument })
  await report.done()
  return persisted.editingDocument
}

async function analyse(
  segments: ReturnType<typeof keptSegments>,
  sourceScript: string | null
): Promise<EditingPlanProposal> {
  const result = await generateStructured({
    agent: structuralAgent,
    schema: AnalysisSchema,
    label: "structural analysis",
    prompt: [
      "Here is the approved script as numbered segments.",
      "Return a few major sections and a selective visual plan.",
      "",
      renderSegments(segments),
      ...(sourceScript?.trim()
        ? [
            "",
            "The creator's own original script or outline, for context only —",
            "not ground truth for wording or segment ranges:",
            "",
            sourceScript.trim(),
          ]
        : []),
    ].join("\n"),
  })

  const sections = result.sections
    .map((section, index): EditingSection | null => {
      if (!validRange(section.fromSegment, section.toSegment, segments)) {
        return null
      }
      return {
        id: `section_${String(index + 1).padStart(2, "0")}`,
        fromSegment: section.fromSegment,
        toSegment: section.toSegment,
        name: section.name.trim(),
        reason: section.reason.trim(),
        source: "automatic",
      }
    })
    .filter((section): section is EditingSection => section !== null)

  const byIndex = new Map(sections.map((section, index) => [index, section]))
  const elements = result.elements
    .map((element, index): EditingPlanElement | null => {
      const section = byIndex.get(element.section)
      if (
        !section ||
        !validRange(element.fromSegment, element.toSegment, segments)
      ) {
        return null
      }
      return {
        id: `automatic_${element.type}_${element.fromSegment}_${element.toSegment}_${index}`,
        sectionId: section.id,
        type: element.type,
        source: "automatic",
        status: "proposed",
        fromSegment: element.fromSegment,
        toSegment: element.toSegment,
        reason: element.reason.trim(),
        confidence: element.confidence ?? 0.5,
        ...(element.titleText ? { titleText: element.titleText.trim() } : {}),
        ...(element.zoomPreset ? { zoomPreset: element.zoomPreset } : {}),
        ...(element.zoomDurationSec
          ? { zoomDurationSec: element.zoomDurationSec }
          : {}),
        ...(element.coversLine
          ? { coversLine: element.coversLine.trim() }
          : {}),
        ...(element.intent ? { intent: element.intent.trim() } : {}),
        ...(element.sceneType ? { sceneType: element.sceneType } : {}),
        ...(element.lowerThirdName
          ? { lowerThirdName: element.lowerThirdName.trim() }
          : {}),
        ...(element.lowerThirdRole
          ? { lowerThirdRole: element.lowerThirdRole.trim() }
          : {}),
        ...(element.type === "lower-third" && element.lowerThirdName
          ? {
              titleText: element.lowerThirdRole
                ? `${element.lowerThirdName.trim()} | ${element.lowerThirdRole.trim()}`
                : element.lowerThirdName.trim(),
            }
          : {}),
      }
    })
    .filter((element): element is EditingPlanElement => element !== null)

  return { sections, elements }
}

function validRange(from: number, to: number, segments: { index: number }[]) {
  if (from > to) return false
  const indexes = new Set(segments.map((segment) => segment.index))
  // Segment indexes are transcript identities, not a contiguous timeline:
  // cleanup may remove the middle of an otherwise valid visual window.
  return indexes.has(from) && indexes.has(to)
}

export function materializeScenes(
  project: Awaited<ReturnType<typeof readStoredProject>>,
  document: EditingDocument
): { scenes: StoredScene[]; document: EditingDocument } {
  const segments = keptSegments(
    buildSegments(project.transcript.words),
    project.spans
  )
  const byIndex = new Map(segments.map((segment) => [segment.index, segment]))
  const previous = new Map(
    project.scenes
      .filter((scene) => scene.planElementId)
      .map((scene) => [scene.planElementId!, scene])
  )
  const scenes = new Map(project.scenes.map((scene) => [scene.id, scene]))
  let nextDocument = document

  // A second plan review can reject an element that already produced a scene.
  // Keep the historical scene record for traceability, but make it ineligible
  // for generation/export/composition instead of silently leaving old B-roll
  // in the next timeline.
  for (const scene of scenes.values()) {
    const element = scene.planElementId
      ? document.elements.find(
          (candidate) => candidate.id === scene.planElementId
        )
      : undefined
    if (!element || element.type !== "scene" || element.status === "approved") {
      continue
    }
    scenes.set(scene.id, { ...scene, status: "rejected" })
    nextDocument = updatePlanElementLifecycle(nextDocument, element.id, {
      sceneId: scene.id,
      renderStatus: "rejected",
      htmlPath: null,
      exportPath: null,
      compositionStatus: "not-composed",
      compositionError: "The plan element is no longer approved.",
    })
  }

  document.elements
    .filter(
      (element) => element.type === "scene" && element.status === "approved"
    )
    .forEach((element, index) => {
      const from = byIndex.get(element.fromSegment)
      const to = byIndex.get(element.toSegment)
      const old = previous.get(element.id)
      if (!from || !to) {
        if (old) {
          scenes.set(old.id, {
            ...old,
            status: "rejected",
            error: "The approved scene is no longer anchored to kept segments.",
          })
        }
        nextDocument = updatePlanElementLifecycle(nextDocument, element.id, {
          compositionStatus: "placement-failed",
          renderStatus: old ? "failed" : undefined,
          ...(old ? { sceneId: old.id } : {}),
          compositionError:
            "The approved scene is no longer anchored to kept segments.",
        })
        return
      }

      const placementError =
        from.file !== to.file
          ? "The scene spans more than one source file and cannot be placed safely."
          : to.end <= from.start
            ? "The scene has an empty or reversed time window."
            : null

      if (placementError) {
        if (old) {
          scenes.set(old.id, {
            ...old,
            status: "rejected",
            error: placementError,
          })
        }
        nextDocument = updatePlanElementLifecycle(nextDocument, element.id, {
          compositionStatus: "placement-failed",
          renderStatus: old ? "failed" : undefined,
          ...(old ? { sceneId: old.id } : {}),
          compositionError: placementError,
        })
        return
      }

      if (old) {
        nextDocument = updatePlanElementLifecycle(nextDocument, element.id, {
          sceneId: old.id,
          renderStatus: sceneRenderStatus(old),
          htmlPath: old.htmlPath,
          exportPath: old.exportPath,
          renderError: old.error,
          compositionStatus: element.compositionStatus ?? "not-composed",
        })
        return
      }

      const id = `scene_${String(index + 1).padStart(2, "0")}_${safeId(element.id)}`
      scenes.set(id, {
        id,
        planElementId: element.id,
        scriptStart: from.start,
        scriptEnd: to.end,
        windowSec: to.end - from.start,
        coversLine: element.coversLine ?? from.text,
        sourceFile: from.file,
        intent: element.intent ?? element.reason,
        type: element.sceneType ?? "concept",
        status: "pending",
        htmlPath: null,
        exportPath: null,
        measuredDurationSec: null,
      } satisfies StoredScene)
      nextDocument = updatePlanElementLifecycle(nextDocument, element.id, {
        sceneId: id,
        renderStatus: "pending",
        htmlPath: null,
        exportPath: null,
        compositionStatus: "not-composed",
        compositionError: undefined,
      })
    })

  return {
    scenes: [...scenes.values()].sort((a, b) => a.scriptStart - b.scriptStart),
    document: nextDocument,
  }
}

function safeId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_")
}
