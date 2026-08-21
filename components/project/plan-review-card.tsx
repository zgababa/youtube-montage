"use client"

import * as React from "react"

import { buildEditingDocument } from "@/lib/project"
import { applyEditingPlanDecisions } from "@/src/mastra/lib/editing-plan"
import type { Project } from "@/lib/types"
import type {
  PlanElementDecision,
  PlanSectionDecision,
} from "@/src/mastra/stream/contract"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StageSection } from "@/components/project/stage"

export function PlanReviewCard({
  project,
  active,
  elementDecisions,
  sectionDecisions,
  onElementDecision,
  onSectionDecision,
  onAcceptSection,
}: {
  project: Project
  active: boolean
  elementDecisions: PlanElementDecision[]
  sectionDecisions: PlanSectionDecision[]
  onElementDecision: (decision: PlanElementDecision) => void
  onSectionDecision: (decision: PlanSectionDecision) => void
  onAcceptSection: (sectionId: string) => void
}) {
  const document = React.useMemo(() => {
    const view = buildEditingDocument(project)
    const plan = applyEditingPlanDecisions(
      {
        sections: view.sections,
        elements: view.elements,
        analysisAt: view.analysisAt,
        reviewedAt: view.reviewedAt,
      },
      elementDecisions,
      sectionDecisions
    )
    return { ...view, ...plan }
  }, [project, elementDecisions, sectionDecisions])

  return (
    <StageSection
      title="Editorial plan"
      description={
        active
          ? "Review the proposed sections and visual elements. Nothing is rendered until you approve this plan."
          : document.reviewedAt
            ? "Approved plan — accepted elements are the only ones sent to renderers."
            : "The structural analysis will appear here after timeline approval."
      }
    >
      {document.sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sections proposed yet.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {document.sections.map((section, index) => {
            const elements = document.elements.filter(
              (element) => element.sectionId === section.id
            )
            const next = document.sections[index + 1]
            return (
              <section key={section.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    defaultValue={section.name}
                    disabled={!active}
                    aria-label={`Section ${index + 1} name`}
                    className="min-w-48 flex-1"
                    onBlur={(event) => {
                      if (event.target.value.trim() !== section.name) {
                        onSectionDecision({
                          id: section.id,
                          action: "rename",
                          name: event.target.value,
                        })
                      }
                    }}
                  />
                  <Badge variant="outline">
                    Segments {section.fromSegment}–{section.toSegment}
                  </Badge>
                  {active ? (
                    <>
                      {section.toSegment > section.fromSegment ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            onSectionDecision({
                              id: section.id,
                              action: "split",
                              splitAtSegment:
                                section.fromSegment +
                                Math.ceil(
                                  (section.toSegment -
                                    section.fromSegment +
                                    1) /
                                    2
                                ),
                            })
                          }
                        >
                          Split
                        </Button>
                      ) : null}
                      {next ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            onSectionDecision({
                              id: section.id,
                              action: "merge",
                              mergeWithId: next.id,
                            })
                          }
                        >
                          Merge next
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onAcceptSection(section.id)}
                      >
                        Accept section
                      </Button>
                    </>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {section.reason}
                </p>
                <div className="mt-4 flex flex-col gap-3">
                  {elements.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No visual elements proposed for this section.
                    </p>
                  ) : (
                    elements.map((element) => (
                      <ElementRow
                        key={element.id}
                        element={element}
                        active={active}
                        onDecision={onElementDecision}
                      />
                    ))
                  )}
                </div>
              </section>
            )
          })}
          {document.elements.some(
            (element) =>
              element.status === "orphaned" ||
              !document.sections.some(
                (section) => section.id === element.sectionId
              )
          ) ? (
            <section className="rounded-lg border border-destructive/40 p-4">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium">Orphaned intentions</h4>
                <Badge variant="destructive">needs repair</Badge>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                {document.elements
                  .filter(
                    (element) =>
                      element.status === "orphaned" ||
                      !document.sections.some(
                        (section) => section.id === element.sectionId
                      )
                  )
                  .map((element) => (
                    <ElementRow
                      key={element.id}
                      element={element}
                      active={active}
                      onDecision={onElementDecision}
                    />
                  ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </StageSection>
  )
}

function ElementRow({
  element,
  active,
  onDecision,
}: {
  element: Project["editingDocument"]["elements"][number]
  active: boolean
  onDecision: (decision: PlanElementDecision) => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{element.type}</Badge>
        <Badge variant={element.status === "approved" ? "default" : "outline"}>
          {element.status}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Segments {element.fromSegment}–{element.toSegment}
        </span>
      </div>
      <p className="text-sm">{element.reason}</p>
      {element.type === "title" ? (
        <Input
          defaultValue={element.titleText ?? ""}
          disabled={!active || element.status === "orphaned"}
          aria-label={`Title copy for ${element.id}`}
          onBlur={(event) =>
            event.target.value !== (element.titleText ?? "")
              ? onDecision({
                  id: element.id,
                  action: "modify",
                  titleText: event.target.value,
                })
              : undefined
          }
        />
      ) : null}
      {element.type !== "title" ? (
        <Input
          defaultValue={element.intent ?? element.reason}
          disabled={!active || element.status === "orphaned"}
          aria-label={`Edit reason for ${element.id}`}
          onBlur={(event) =>
            event.target.value !== (element.intent ?? element.reason)
              ? onDecision({
                  id: element.id,
                  action: "modify",
                  intent: event.target.value,
                })
              : undefined
          }
        />
      ) : null}
      {element.type === "zoom" ? (
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Preset
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
              defaultValue={element.zoomPreset ?? "medium"}
              disabled={!active || element.status === "orphaned"}
              aria-label={`Zoom preset for ${element.id}`}
              onChange={(event) =>
                onDecision({
                  id: element.id,
                  action: "modify",
                  zoomPreset: event.target.value as
                    "subtle" | "medium" | "strong",
                })
              }
            >
              <option value="subtle">Subtle</option>
              <option value="medium">Medium</option>
              <option value="strong">Strong</option>
            </select>
          </label>
          <Input
            className="w-28"
            type="number"
            min={0.5}
            max={4}
            step={0.1}
            defaultValue={element.zoomDurationSec ?? 2}
            disabled={!active || element.status === "orphaned"}
            aria-label={`Zoom duration for ${element.id}`}
            onBlur={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value) && value !== element.zoomDurationSec) {
                onDecision({
                  id: element.id,
                  action: "modify",
                  zoomDurationSec: value,
                })
              }
            }}
          />
        </div>
      ) : null}
      {element.type === "scene" && element.intent ? (
        <p className="text-xs text-muted-foreground">{element.intent}</p>
      ) : null}
      {active ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => onDecision({ id: element.id, action: "approve" })}
            disabled={element.status === "orphaned"}
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDecision({ id: element.id, action: "reject" })}
          >
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  )
}
