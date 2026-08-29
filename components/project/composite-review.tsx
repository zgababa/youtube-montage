"use client"

import type { Project } from "@/lib/types"
import type { PipelineDataParts } from "@/src/mastra/stream/contract"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { StageSection } from "@/components/project/stage"

/**
 * The fourth gate: the same `timeline.fcpxml` gate 2 wrote, now rewritten
 * with every exported scene composited in as a connected clip on lane 1
 * (idea.md §4.2 covers the other three).
 *
 * Unlike the timeline gate, there's nothing to tune here — the compositing is
 * deterministic from what's on disk. "Regenerate" exists anyway: it's the way
 * to pick up scenes exported since the last pass, and it's cheap (no LLM
 * call, no rendering — just a rewrite), so offering it costs nothing.
 */
export function CompositeReview({
  project,
  composite,
  onRegenerate,
  onApprove,
  disabled,
}: {
  project: Project
  composite: PipelineDataParts["composite"] | null
  onRegenerate: () => void
  onApprove: () => void
  disabled: boolean
}) {
  const approved = project.compositeApprovedAt !== null

  return (
    <StageSection
      description={
        <>
          Rewrites <span className="font-mono">timeline.fcpxml</span> with
          every exported scene laid in as a connected clip. Re-import it into
          DaVinci once approved — the earlier import from the timeline gate is
          now out of date.
        </>
      }
      footer={
        <>
          <span>
            {composite
              ? `${composite.placedCount} scene${composite.placedCount === 1 ? "" : "s"} composited`
              : null}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onRegenerate} disabled={disabled}>
              Regenerate
            </Button>
            <Button onClick={onApprove} disabled={disabled || approved}>
              {approved ? "Approved" : "Approve composite"}
            </Button>
          </div>
        </>
      }
    >
      {composite && composite.skipped.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>
            {composite.skipped.length} scene
            {composite.skipped.length === 1 ? "" : "s"} didn't land on the cut
            timeline
          </AlertTitle>
          <AlertDescription>
            {composite.skipped.join(", ")} — their moment ended up cut from
            the timeline. They still exported to `.mov`; place them manually
            from the shot list.
          </AlertDescription>
        </Alert>
      ) : null}

      {composite === null ? (
        <p className="text-xs text-muted-foreground">
          Regenerate to composite the scenes exported so far.
        </p>
      ) : null}
    </StageSection>
  )
}
