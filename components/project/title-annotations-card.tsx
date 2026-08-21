"use client"

import * as React from "react"

import { timecode } from "@/lib/format"
import {
  createTitleAnnotation,
  decideTitleAnnotation,
  type TitleAnnotationDecision,
} from "@/src/mastra/lib/titles"
import { buildSegments, keptSegments } from "@/src/mastra/lib/segments"
import type { Project, TitleAnnotation } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { StageSection } from "@/components/project/stage"

const STATUS_VARIANT: Record<
  TitleAnnotation["status"],
  "outline" | "default" | "destructive"
> = {
  pending: "outline",
  approved: "default",
  rejected: "destructive",
}

/**
 * Manual TITRE annotations (issue #7, ADR 0004/0005).
 *
 * Lets the creator pick a segment of the approved script — never a raw
 * transcript edit — and attach a title's worth of copy to it. Only kept
 * segments are offered: `createTitleAnnotation` would refuse a cut one
 * anyway, but there's no reason to offer a target the review will bounce.
 */
export function TitleAnnotationsCard({
  project,
  onChange,
}: {
  project: Project
  onChange: (annotations: TitleAnnotation[]) => void
}) {
  const [segmentIndex, setSegmentIndex] = React.useState<string>("")
  const [draft, setDraft] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const segments = React.useMemo(
    () => buildSegments(project.transcript.words),
    [project.transcript.words]
  )
  const available = React.useMemo(
    () => keptSegments(segments, project.spans),
    [segments, project.spans]
  )

  if (project.cleanupApprovedAt === null) return null

  function addAnnotation() {
    setError(null)
    if (segmentIndex === "" || draft.trim().length === 0) return

    try {
      const annotation = createTitleAnnotation({
        segments,
        spans: project.spans,
        segmentIndex: Number(segmentIndex),
        text: draft.trim(),
      })
      onChange([...project.titleAnnotations, annotation])
      setDraft("")
      setSegmentIndex("")
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown))
    }
  }

  function decide(id: string, decision: TitleAnnotationDecision) {
    onChange(
      project.titleAnnotations.map((annotation) =>
        annotation.id === id
          ? decideTitleAnnotation(annotation, decision)
          : annotation
      )
    )
  }

  return (
    <StageSection
      title="TITRE annotations"
      description="Attach a title screen to a moment in the approved script, without touching the transcript."
    >
      <div className="flex flex-col gap-3 rounded-xl border p-4">
        <Field>
          <FieldLabel htmlFor="title-target">Target segment</FieldLabel>
          <Select
            value={segmentIndex}
            onValueChange={(value) => setSegmentIndex(value ?? "")}
          >
            <SelectTrigger id="title-target">
              <SelectValue placeholder="Pick a segment of the approved script…" />
            </SelectTrigger>
            <SelectContent>
              {available.map((segment) => (
                <SelectItem key={segment.index} value={String(segment.index)}>
                  {timecode(segment.start)} — {segment.text.slice(0, 60)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="title-text">TITRE text</FieldLabel>
          <Textarea
            id="title-text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="The agents"
          />
        </Field>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button
          size="sm"
          onClick={addAnnotation}
          disabled={segmentIndex === "" || draft.trim().length === 0}
        >
          Add TITRE
        </Button>
      </div>

      {project.titleAnnotations.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {project.titleAnnotations.map((annotation) => (
            <AnnotationRow
              // The saved copy is part of the key rather than a resync effect
              // (this project's lint rules flag `setState` in an effect body
              // as a cascading-render risk — see react-hooks/set-state-in-effect):
              // a successful save remounts the row and its draft starts fresh
              // from the new value.
              key={`${annotation.id}:${annotation.text}`}
              annotation={annotation}
              onDecide={(decision) => decide(annotation.id, decision)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          No TITRE annotation yet.
        </p>
      )}
    </StageSection>
  )
}

/**
 * One annotation under review, editing against a local draft.
 *
 * The text box is deliberately *not* wired straight to `onDecide`: every
 * decision is persisted with a PATCH, so a controlled field would fire one
 * request and one toast per keystroke and round-trip each character through
 * server state. Same local-draft-plus-explicit-Save shape the style guide
 * editor uses.
 */
function AnnotationRow({
  annotation,
  onDecide,
}: {
  annotation: TitleAnnotation
  onDecide: (decision: TitleAnnotationDecision) => void
}) {
  const [draft, setDraft] = React.useState(annotation.text)

  const dirty = draft.trim() !== annotation.text && draft.trim().length > 0

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">
          {timecode(annotation.scriptStart)}
        </span>
        <Badge variant={STATUS_VARIANT[annotation.status]}>
          {annotation.status}
        </Badge>
      </div>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="text-xs"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDecide({ action: "modify", text: draft.trim() })}
          disabled={!dirty}
        >
          Save text
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDecide({ action: "approve" })}
          disabled={dirty}
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDecide({ action: "reject" })}
        >
          Reject
        </Button>
      </div>
    </li>
  )
}
