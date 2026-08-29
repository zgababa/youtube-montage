"use client"

import * as React from "react"

import {
  plural,
  SCENE_STATUS_LABELS,
  sceneStatusVariant,
  timecode,
} from "@/lib/format"
import { buildDocumentSections, buildEditingDocument } from "@/lib/project"
import type { DocumentBlock } from "@/lib/project"
import type { EditingDocument, Project } from "@/lib/types"
import { decidePlanElement } from "@/src/mastra/lib/editing-plan"
import type { PipelineDataParts } from "@/src/mastra/stream/contract"
import { SceneFrame } from "@/components/scene/scene-frame"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { AddElementDialog } from "@/components/project/add-element-dialog"
import { useSegmentPicker } from "@/components/project/segment-picker"
import { StageSection } from "@/components/project/stage"
import { TimelineControl } from "@/components/project/timeline-control"

type Decide = (
  elementId: string,
  decision: Parameters<typeof decidePlanElement>[1]
) => void

/**
 * The editing document (issue #5, ADR 0006 and after).
 *
 * Once a structural plan exists, the document reads as a screenplay: the
 * script broken into the sections the analysis proposed, with TITRE, ZOOM
 * and SCÈNE B-ROLL markers sitting inline at the moment they happen. Before
 * that — cleanup just approved, no analysis yet — it falls back to the flat
 * script and known-elements view issue #6 introduced.
 *
 * Also where a new element gets added by hand: click a segment to start a
 * range, click another to end it, then pick a type in the dialog that opens.
 * The picker lives here rather than inside `ScreenplayView`/`FlatView`
 * because both need to share the same range state.
 */
export function EditingDocumentCard({
  project,
  onSaveEditingDocument,
  timeline,
  composite,
  disabled,
  onUpdateTimeline,
}: {
  project: Project
  onSaveEditingDocument: (editingDocument: EditingDocument) => void
  timeline: PipelineDataParts["fcpxml"] | null
  composite: PipelineDataParts["composite"] | null
  disabled: boolean
  onUpdateTimeline: (maxSilenceSec: number) => Promise<void>
}) {
  const document = React.useMemo(() => buildEditingDocument(project), [
    project,
  ])
  const structured = React.useMemo(
    () => buildDocumentSections(project, document),
    [project, document]
  )
  const picker = useSegmentPicker()

  function addElement(element: (typeof project.editingDocument.elements)[number]) {
    onSaveEditingDocument({
      ...project.editingDocument,
      elements: [...project.editingDocument.elements, element],
    })
  }

  const decideElement: Decide = (elementId, decision) => {
    const element = project.editingDocument.elements.find(
      (candidate) => candidate.id === elementId
    )
    if (!element) return
    const next = decidePlanElement(element, decision)
    onSaveEditingDocument({
      ...project.editingDocument,
      elements: project.editingDocument.elements.map((candidate) =>
        candidate.id === elementId ? next : candidate
      ),
    })
  }

  return (
    <StageSection
      title="Editing document"
      description={
        document.script === null
          ? "Opens once the cleanup is approved — the approved script is its first layer."
          : `${plural(document.script.keptSpanCount, "span")} kept · ${plural(document.entries.length, "known element")}`
      }
    >
      {document.script === null ? (
        <p className="text-xs text-muted-foreground">
          No document yet. Approve the cleanup to see it appear.
        </p>
      ) : (
        <>
          <TimelineControl
            project={project}
            timeline={timeline}
            composite={composite}
            disabled={disabled}
            onUpdate={onUpdateTimeline}
          />
          {picker.picking ? (
            <p className="text-xs text-muted-foreground">
              Click the end of the range, or{" "}
              <button
                type="button"
                className="underline"
                onClick={picker.cancel}
              >
                cancel
              </button>
              .
            </p>
          ) : null}
          {structured.sections.length > 0 ? (
            <ScreenplayView
              structured={structured}
              entries={document.entries}
              titles={document.titles}
              scenes={project.scenes}
              picker={picker}
              onDecide={decideElement}
            />
          ) : (
            <FlatView document={document} picker={picker} />
          )}
          <AddElementDialog
            project={project}
            range={picker.range}
            onClose={picker.clearRange}
            onCreate={addElement}
          />
        </>
      )}
    </StageSection>
  )
}

type Picker = ReturnType<typeof useSegmentPicker>

function ScreenplayView({
  structured,
  entries,
  titles,
  scenes,
  picker,
  onDecide,
}: {
  structured: ReturnType<typeof buildDocumentSections>
  entries: ReturnType<typeof buildEditingDocument>["entries"]
  titles: ReturnType<typeof buildEditingDocument>["titles"]
  scenes: Project["scenes"]
  picker: Picker
  onDecide: Decide
}) {
  return (
    <div className="flex flex-col gap-6">
      {structured.sections.map((section) => (
        <section key={section.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
            <h4 className="text-xs font-normal italic tracking-tight text-muted-foreground">
              <Badge variant="outline" className="mr-2 not-italic align-middle">
                section
              </Badge>
              {section.name}
            </h4>
            <span className="text-xs italic text-muted-foreground">
              {section.reason}
            </span>
          </div>
          <div className="flex flex-col gap-4">
            {section.blocks.map((block, index) => (
              <Block
                key={blockKey(block, index)}
                block={block}
                scenes={scenes}
                picker={picker}
                onDecide={onDecide}
              />
            ))}
          </div>
        </section>
      ))}

      {structured.unplaced.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h4 className="text-xs font-normal italic tracking-tight text-muted-foreground">
            <Badge variant="outline" className="mr-2 not-italic align-middle">
              section
            </Badge>
            Outside any section
          </h4>
          <div className="flex flex-col gap-3">
            {structured.unplaced.map((block, index) => (
              <Block
                key={blockKey(block, index)}
                block={block}
                scenes={scenes}
                picker={picker}
                onDecide={onDecide}
              />
            ))}
          </div>
        </section>
      ) : null}

      {entries.length === 0 && titles.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No known element yet.
        </p>
      ) : null}
    </div>
  )
}

function blockKey(block: DocumentBlock, index: number) {
  return block.kind === "text" ? `text-${index}` : block.id
}

function SegmentText({
  segments,
  picker,
}: {
  segments: { index: number; text: string }[]
  picker: Picker
}) {
  return (
    <p className="pl-4 text-xs leading-relaxed whitespace-pre-wrap">
      {segments.map((segment, index) => {
        const inRange =
          picker.range &&
          segment.index >= picker.range.from &&
          segment.index <= picker.range.to
        const pending =
          picker.pending &&
          segment.index >= picker.pending.from &&
          segment.index <= picker.pending.to
        return (
          <span
            key={segment.index}
            data-segment-index={segment.index}
            onClick={() => picker.onSegmentClick(segment.index)}
            onMouseEnter={() => picker.onSegmentHover(segment.index)}
            className={
              "cursor-pointer rounded-sm " +
              (inRange
                ? "bg-primary/20"
                : pending
                  ? "bg-primary/10"
                  : "hover:bg-muted")
            }
          >
            {segment.text}
            {index < segments.length - 1 ? " " : ""}
          </span>
        )
      })}
    </p>
  )
}

function Block({
  block,
  scenes,
  picker,
  onDecide,
}: {
  block: DocumentBlock
  scenes: Project["scenes"]
  picker: Picker
  onDecide: Decide
}) {
  if (block.kind === "text") {
    return <SegmentText segments={block.segments} picker={picker} />
  }
  if (block.kind === "title") {
    return (
      <TitleMarker
        id={block.id}
        text={block.text}
        source={block.source}
        scriptStart={block.scriptStart}
        status={block.status}
        composed={block.composed}
        wouldCompose={block.wouldCompose}
        onDecide={onDecide}
      />
    )
  }
  if (block.kind === "zoom") {
    return (
      <Marker
        icon="🔍"
        label="ZOOM"
        detail={
          block.preset
            ? `${block.preset}${block.durationSec ? ` · ${block.durationSec}s` : ""}`
            : block.reason
        }
        scriptStart={block.scriptStart}
        onApprove={
          block.status !== "approved" && block.status !== "orphaned"
            ? () => onDecide(block.id, { action: "approve" })
            : undefined
        }
        onDelete={
          block.status !== "rejected"
            ? () => onDecide(block.id, { action: "reject" })
            : undefined
        }
      />
    )
  }
  const scene = scenes.find((candidate) => candidate.id === block.id)
  return (
    <SceneMarker
      label="SCÈNE B-ROLL"
      detail={block.reason}
      scriptStart={block.scriptStart}
      html={scene?.html ?? null}
      onApprove={
        block.planElementId &&
        block.status !== "approved" &&
        block.status !== "orphaned"
          ? () => onDecide(block.planElementId!, { action: "approve" })
          : undefined
      }
      onDelete={
        block.planElementId && block.status !== "rejected"
          ? () => onDecide(block.planElementId!, { action: "reject" })
          : undefined
      }
    />
  )
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label="Remove"
      onClick={onClick}
    >
      ×
    </Button>
  )
}

/**
 * Approves a zoom or scene element directly from the document — a plain
 * PATCH (`decidePlanElement`), the same as a title's Approve. Never gated
 * on a live run: only *generating* a scene needs the workflow (Submit
 * review, which sweeps up every approved-but-unmaterialized scene), not
 * marking the intention approved in the first place.
 */
function ApproveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="xs" variant="ghost" onClick={onClick}>
      Approve
    </Button>
  )
}

/**
 * ADR 0006's `Composé` (the last actual build of `timeline.fcpxml`) versus a
 * live prediction of what the *next* build would do — kept visibly distinct
 * rather than collapsed into one badge, so exporting a scene doesn't read as
 * "already in the file" before "Update timeline" has actually rebuilt it.
 */
function ComposedBadge({
  composed,
  wouldCompose,
}: {
  composed: boolean
  wouldCompose?: boolean
}) {
  return (
    <>
      <Badge variant={composed ? "default" : "outline"}>
        {composed ? "composed" : "not composed"}
      </Badge>
      {!composed && wouldCompose ? (
        <Badge variant="outline" title="Will be included next time timeline.fcpxml is rebuilt.">
          ready to update
        </Badge>
      ) : null}
    </>
  )
}

function Marker({
  icon,
  label,
  detail,
  scriptStart,
  onApprove,
  onDelete,
}: {
  icon: string
  label: string
  detail: string
  scriptStart: number
  onApprove?: () => void
  onDelete?: () => void
}) {
  return (
    <div className="ml-2 flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-xs">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">
          {icon} {label}
        </span>
        <span className="truncate text-muted-foreground">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-muted-foreground">{timecode(scriptStart)}</span>
        {onApprove ? <ApproveButton onClick={onApprove} /> : null}
        {onDelete ? <DeleteButton onClick={onDelete} /> : null}
      </span>
    </div>
  )
}

/**
 * A SCÈNE B-ROLL marker. Its animation is never loaded until "Preview" is
 * clicked — the HTML is already sitting in `project.scenes[].html` (issue
 * #5 hydrates it server-side), but rendering every scene's iframe the
 * moment the document mounts would be a lot of unwanted motion and cost.
 */
function SceneMarker({
  label,
  detail,
  scriptStart,
  html,
  onApprove,
  onDelete,
}: {
  label: string
  detail: string
  scriptStart: number
  html: string | null
  onApprove?: () => void
  onDelete?: () => void
}) {
  const [previewing, setPreviewing] = React.useState(false)

  return (
    <div className="ml-2 flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">🎬 {label}</span>
          <span className="truncate text-muted-foreground">{detail}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground">{timecode(scriptStart)}</span>
          {html ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setPreviewing((current) => !current)}
            >
              {previewing ? "Hide" : "Preview"}
            </Button>
          ) : null}
          {onApprove ? <ApproveButton onClick={onApprove} /> : null}
          {onDelete ? <DeleteButton onClick={onDelete} /> : null}
        </span>
      </div>

      {previewing && html ? (
        <div className="border-t pt-2">
          <SceneFrame html={html} title={`Preview of ${label}`} />
        </div>
      ) : null}
    </div>
  )
}

/** A TITRE marker, with approve/reject/edit inline instead of a separate card. */
function TitleMarker({
  id,
  text,
  source,
  scriptStart,
  status,
  composed,
  wouldCompose,
  onDecide,
}: {
  id: string
  text: string
  source: "manual" | "automatic"
  scriptStart: number
  status: string
  composed: boolean
  wouldCompose: boolean
  onDecide: Decide
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(text)

  return (
    <div className="ml-2 flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">
            🏷 {source === "manual" ? "TITRE" : "TITRE (proposed)"}
          </span>
          <span className="truncate text-muted-foreground">« {text} »</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground">{timecode(scriptStart)}</span>
          <ComposedBadge composed={composed} wouldCompose={wouldCompose} />
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setDraft(text)
              setEditing((current) => !current)
            }}
          >
            Edit
          </Button>
          {status !== "rejected" ? (
            <DeleteButton onClick={() => onDecide(id, { action: "reject" })} />
          ) : null}
        </span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2 border-t pt-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="text-xs"
          />
          <div className="flex justify-end gap-2">
            {status !== "rejected" ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => onDecide(id, { action: "reject" })}
              >
                Reject
              </Button>
            ) : null}
            {status !== "approved" ? (
              <Button
                size="xs"
                onClick={() => onDecide(id, { action: "approve" })}
              >
                Approve
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="outline"
              disabled={draft === text}
              onClick={() => {
                onDecide(id, { action: "modify", titleText: draft })
                setEditing(false)
              }}
            >
              Save text
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Before any structural plan exists: the flat script + lists view. */
function FlatView({
  document,
  picker,
}: {
  document: ReturnType<typeof buildEditingDocument>
  picker: Picker
}) {
  const { script, entries, titles } = document
  if (script === null) return null

  return (
    <>
      <ScrollArea className="h-40 overflow-hidden rounded-xl bg-muted/50">
        {script.segments.length > 0 ? (
          <div className="p-4">
            <SegmentText segments={script.segments} picker={picker} />
          </div>
        ) : (
          <p className="p-4 text-xs leading-relaxed text-muted-foreground">
            Empty script.
          </p>
        )}
      </ScrollArea>

      {entries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.sceneId}
              className="flex items-center justify-between gap-3 rounded-lg border p-3 text-xs"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{entry.sceneId}</span>
                <span className="truncate text-muted-foreground">
                  {entry.reason}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-muted-foreground">
                  {timecode(entry.scriptStart)}
                </span>
                <Badge variant={sceneStatusVariant(entry.status)}>
                  {SCENE_STATUS_LABELS[entry.status]}
                </Badge>
                {entry.planElementId ? (
                  <ComposedBadge
                    composed={entry.compositionStatus === "composed"}
                    wouldCompose={entry.wouldCompose}
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No known element yet.</p>
      )}

      {titles.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {titles.map((title) => (
            <li
              key={title.elementId}
              className="flex items-center justify-between gap-3 rounded-lg border p-3 text-xs"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">TITRE</span>
                <span className="truncate text-muted-foreground">
                  {title.text}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-muted-foreground">
                  {timecode(title.scriptStart)}
                </span>
                <Badge
                  variant={title.status === "approved" ? "default" : "outline"}
                >
                  {title.status}
                </Badge>
                <ComposedBadge
                  composed={title.composed}
                  wouldCompose={title.wouldCompose}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}
