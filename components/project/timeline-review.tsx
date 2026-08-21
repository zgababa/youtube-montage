"use client"

import * as React from "react"

import { durationLabel } from "@/lib/format"
import type { Project } from "@/lib/types"
import type { PipelineDataParts } from "@/src/mastra/stream/contract"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { StageSection } from "@/components/project/stage"

/**
 * The third gate: the cut written as FCPXML, before scenes exist (idea.md
 * §4.2 covers the other two).
 *
 * `timeline` carries the last generation's stats — it comes from the stream,
 * not `project.json`, because `runsCount`/`totalDurationSec` are display
 * numbers, not something worth persisting. `maxSilenceSec` lives in both
 * places: the project's copy is what a fresh run starts from, the stream's is
 * what the last regenerate or approve actually used.
 */
export function TimelineReview({
  project,
  timeline,
  onRegenerate,
  onApprove,
  disabled,
}: {
  project: Project
  timeline: PipelineDataParts["fcpxml"] | null
  onRegenerate: (maxSilenceSec: number) => void
  onApprove: (maxSilenceSec: number) => void
  disabled: boolean
}) {
  const [draft, setDraft] = React.useState(
    timeline?.maxSilenceSec ?? project.maxSilenceSec
  )

  const dirty = draft !== (timeline?.maxSilenceSec ?? project.maxSilenceSec)

  return (
    <StageSection
      description={
        <>
          Written to <span className="font-mono">timeline.fcpxml</span>, next
          to <span className="font-mono">project.json</span>. Import it into
          DaVinci once approved.
        </>
      }
      footer={
        <>
          <span>
            {timeline
              ? `${timeline.runsCount} clip${timeline.runsCount === 1 ? "" : "s"} · ${durationLabel(timeline.totalDurationSec)}`
              : null}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onRegenerate(draft)}
              disabled={disabled || !dirty}
            >
              Regenerate
            </Button>
            <Button
              onClick={() => onApprove(draft)}
              disabled={disabled || project.timelineApprovedAt !== null}
            >
              {project.timelineApprovedAt !== null
                ? "Approved"
                : "Approve timeline"}
            </Button>
          </div>
        </>
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="max-silence">Silence cap</FieldLabel>
          <Input
            id="max-silence"
            type="number"
            min={0.05}
            max={2}
            step={0.05}
            value={draft}
            onChange={(event) =>
              setDraft(Number.parseFloat(event.target.value) || 0)
            }
            className="w-24 font-mono text-xs"
          />
          <FieldDescription>
            Longest silence kept between two kept lines of the same file, in
            seconds. Segments only ever break on a pause of 0.6s or more, so
            anything below that has no effect. Regenerate to preview a value
            before approving.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </StageSection>
  )
}
