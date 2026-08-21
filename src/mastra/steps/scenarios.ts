/**
 * Structural analysis and plan review.
 *
 * This step owns the first visual decision gate. It writes the proposed plan,
 * suspends before any renderer runs, and only materialises accepted B-roll
 * elements as scene jobs after the creator approves the plan.
 */

import { createStep } from "@mastra/core/workflows"
import { z } from "zod"

import { structuralAgent } from "../agents/structural-agent"
import {
  applyEditingPlanDecisions,
  mergeEditingPlan,
  parseTitleCommands,
  type EditingPlanProposal,
} from "../lib/editing-plan"
import { readStoredProject, updateProject } from "../lib/project"
import { buildSegments, keptSegments, renderSegments } from "../lib/segments"
import {
  EditingDocumentSchema,
  PlanElementTypeSchema,
  SceneTypeSchema,
  ZoomPresetSchema,
  type EditingDocument,
  type EditingPlanElement,
  type EditingSection,
  type StoredScene,
} from "../schemas"
import { generateStructured } from "../lib/structured"
import { PipelineIO, reporter } from "./shared"

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
      titleText: z.string().optional(),
      zoomPreset: ZoomPresetSchema.optional(),
      zoomDurationSec: z.number().positive().optional(),
      coversLine: z.string().optional(),
      intent: z.string().optional(),
      sceneType: SceneTypeSchema.optional(),
    })
  ),
})

const PlanDecisionSchema = z.object({
  id: z.string(),
  action: z.enum(["approve", "reject", "modify"]),
  titleText: z.string().optional(),
  reason: z.string().optional(),
  zoomPreset: ZoomPresetSchema.optional(),
  zoomDurationSec: z.number().positive().optional(),
  coversLine: z.string().optional(),
  intent: z.string().optional(),
})

const SectionDecisionSchema = z.object({
  id: z.string(),
  action: z.enum(["rename", "split", "merge"]),
  name: z.string().optional(),
  splitAtSegment: z.number().int().optional(),
  mergeWithId: z.string().optional(),
})

const PlanResumeSchema = z.object({
  elementDecisions: z.array(PlanDecisionSchema),
  sectionDecisions: z.array(SectionDecisionSchema),
  done: z.boolean(),
})

export const scenariosStep = createStep({
  id: "scenarios",
  description: "Analyse the approved script and review the editing plan",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  resumeSchema: PlanResumeSchema,
  suspendSchema: z.object({
    reason: z.literal("review-plan"),
    document: EditingDocumentSchema,
  }),
  execute: async ({ inputData, resumeData, writer, runId, suspend }) => {
    const report = reporter("scenarios", writer)
    const { projectPath } = inputData

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

      if (!resumeData) {
        await report.start()
        const proposal = await analyse(segments)
        const merged = mergeEditingPlan(
          project.editingDocument,
          {
            sections: proposal.sections,
            elements: [
              ...manualTitleElements(
                project.titleAnnotations,
                proposal.sections
              ),
              ...commandElements(segments, proposal.sections),
              ...proposal.elements,
            ],
          },
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
        await report.emit("gate", {
          on: "review-plan",
          runId,
          step: "scenarios",
        })
        await report.suspended()
        return suspend({ reason: "review-plan", document })
      }

      const reviewed = applyEditingPlanDecisions(
        project.editingDocument,
        resumeData.elementDecisions,
        resumeData.sectionDecisions
      )
      const document: EditingDocument = {
        ...reviewed,
        reviewedAt: resumeData.done
          ? new Date().toISOString()
          : reviewed.reviewedAt,
      }

      await updateProject(projectPath, (current) => ({
        ...current,
        editingDocument: document,
        scenes: resumeData.done
          ? materializeScenes(current, document)
          : current.scenes,
      }))
      await report.emit("document", { document })

      if (!resumeData.done) {
        await report.emit("gate", {
          on: "review-plan",
          runId,
          step: "scenarios",
        })
        await report.suspended()
        return suspend({ reason: "review-plan", document })
      }

      await report.done()
      return { projectPath }
    } catch (error) {
      await report.failed(
        error instanceof Error ? error.message : String(error)
      )
      throw error
    }
  },
})

async function analyse(
  segments: ReturnType<typeof keptSegments>
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
      }
    })
    .filter((element): element is EditingPlanElement => element !== null)

  return { sections, elements }
}

function validRange(from: number, to: number, segments: { index: number }[]) {
  if (from > to) return false
  const indexes = new Set(segments.map((segment) => segment.index))
  for (let index = from; index <= to; index += 1) {
    if (!indexes.has(index)) return false
  }
  return true
}

function sectionFor(
  segmentIndex: number,
  sections: EditingSection[]
): EditingSection | undefined {
  return sections.find(
    (section) =>
      segmentIndex >= section.fromSegment && segmentIndex <= section.toSegment
  )
}

function manualTitleElements(
  annotations: Awaited<
    ReturnType<typeof readStoredProject>
  >["titleAnnotations"],
  sections: EditingSection[]
): EditingPlanElement[] {
  return annotations.map((annotation) => {
    const section = sectionFor(annotation.segmentIndex, sections)
    const anchored = section !== undefined
    return {
      id: `manual_title_${annotation.id}`,
      sectionId: section?.id ?? "orphaned",
      type: "title",
      source: "manual",
      status: anchored
        ? annotation.status === "approved"
          ? "approved"
          : annotation.status === "rejected"
            ? "rejected"
            : "proposed"
        : "orphaned",
      fromSegment: annotation.segmentIndex,
      toSegment: annotation.segmentIndex,
      reason: "Manual TITRE annotation",
      titleText: annotation.text,
    }
  })
}

function commandElements(
  segments: ReturnType<typeof keptSegments>,
  sections: EditingSection[]
): EditingPlanElement[] {
  return parseTitleCommands(segments).flatMap((command, index) => {
    const section = sectionFor(command.segmentIndex, sections)
    if (!section) return []
    return [
      {
        id: `command_title_${command.segmentIndex}_${index}`,
        sectionId: section.id,
        type: "title",
        source: "command",
        status: "proposed",
        fromSegment: command.segmentIndex,
        toSegment: command.segmentIndex,
        reason: "Explicit TITRE command",
        titleText: command.text,
      } satisfies EditingPlanElement,
    ]
  })
}

function materializeScenes(
  project: Awaited<ReturnType<typeof readStoredProject>>,
  document: EditingDocument
): StoredScene[] {
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

  return document.elements
    .filter(
      (element) => element.type === "scene" && element.status === "approved"
    )
    .map((element, index) => {
      const from = byIndex.get(element.fromSegment)
      const to = byIndex.get(element.toSegment)
      if (!from || !to) return null

      const old = previous.get(element.id)
      if (old) return old

      const id = `scene_${String(index + 1).padStart(2, "0")}_${safeId(element.id)}`
      return {
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
      } satisfies StoredScene
    })
    .filter((scene): scene is StoredScene => scene !== null)
}

function safeId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_")
}
