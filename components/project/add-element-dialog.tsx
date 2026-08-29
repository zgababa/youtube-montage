"use client"

import * as React from "react"

import { timecode } from "@/lib/format"
import {
  createScenePlanElement,
  createTitlePlanElement,
  createZoomPlanElement,
} from "@/src/mastra/lib/editing-plan"
import { buildSegments, keptSegments } from "@/src/mastra/lib/segments"
import type { EditingPlanElement, Project, ZoomPreset } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type ElementKind = "title" | "zoom" | "scene"

const ZOOM_PRESETS: ZoomPreset[] = ["subtle", "medium", "strong"]

/**
 * Opens once a range is picked in the document (`segment-picker.tsx`). Every
 * type creates a full `EditingPlanElement` — a title, a zoom or a scene B-roll
 * — that enters the same review the structural analysis's own proposals go
 * through, via the parent's `onCreate`.
 */
export function AddElementDialog({
  project,
  range,
  onClose,
  onCreate,
}: {
  project: Project
  range: { from: number; to: number } | null
  onClose: () => void
  onCreate: (element: EditingPlanElement) => void
}) {
  const [kind, setKind] = React.useState<ElementKind>("title")
  const [titleText, setTitleText] = React.useState("")
  const [zoomPreset, setZoomPreset] = React.useState<ZoomPreset>("medium")
  const [intent, setIntent] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const segments = React.useMemo(
    () => buildSegments(project.transcript.words),
    [project.transcript.words]
  )
  const kept = React.useMemo(
    () => keptSegments(segments, project.spans),
    [segments, project.spans]
  )

  const preview = React.useMemo(() => {
    if (!range) return ""
    return kept
      .filter((s) => s.index >= range.from && s.index <= range.to)
      .map((s) => s.text)
      .join(" ")
  }, [kept, range])

  if (!range) return null

  function reset() {
    setKind("title")
    setTitleText("")
    setZoomPreset("medium")
    setIntent("")
    setError(null)
  }

  function submit() {
    if (!range) return
    setError(null)
    try {
      const input = {
        segments,
        spans: project.spans,
        sections: project.editingDocument.sections,
        fromSegment: range.from,
        toSegment: range.to,
      }
      const element =
        kind === "title"
          ? createTitlePlanElement({ ...input, titleText })
          : kind === "zoom"
            ? createZoomPlanElement({ ...input, zoomPreset })
            : createScenePlanElement({ ...input, intent: intent || undefined })
      onCreate(element)
      reset()
      onClose()
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown))
    }
  }

  const canSubmit = kind !== "title" || titleText.trim().length > 0

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an element</DialogTitle>
          <DialogDescription>
            {timecode(kept.find((s) => s.index === range.from)?.start ?? 0)} —{" "}
            {preview.length > 140 ? `${preview.slice(0, 140)}…` : preview}
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="element-kind">Type</FieldLabel>
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as ElementKind)}
          >
            <SelectTrigger id="element-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title">Title</SelectItem>
              <SelectItem value="zoom">Zoom</SelectItem>
              <SelectItem value="scene">Scène B-roll</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {kind === "title" ? (
          <Field>
            <FieldLabel htmlFor="element-title-text">Title text</FieldLabel>
            <Textarea
              id="element-title-text"
              value={titleText}
              onChange={(event) => setTitleText(event.target.value)}
              placeholder="The agents"
            />
            {range.from !== range.to ? (
              <p className="text-xs text-muted-foreground">
                Titles anchor to the first line of your selection.
              </p>
            ) : null}
          </Field>
        ) : null}

        {kind === "zoom" ? (
          <Field>
            <FieldLabel htmlFor="element-zoom-preset">Preset</FieldLabel>
            <Select
              value={zoomPreset}
              onValueChange={(value) => setZoomPreset(value as ZoomPreset)}
            >
              <SelectTrigger id="element-zoom-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZOOM_PRESETS.map((preset) => (
                  <SelectItem key={preset} value={preset}>
                    {preset}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {kind === "scene" ? (
          <Field>
            <FieldLabel htmlFor="element-intent">
              Intent (optional)
            </FieldLabel>
            <Textarea
              id="element-intent"
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              placeholder={preview.slice(0, 200)}
            />
          </Field>
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            Add {kind === "scene" ? "scene" : kind}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
