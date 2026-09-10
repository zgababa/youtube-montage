"use client"

import type { Project } from "@/lib/types"
import type { PipelineDataParts } from "@/src/mastra/stream/contract"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { StageSection } from "@/components/project/stage"

/**
 * The fourth gate: the cut video and every approved scene's beat sheet
 * entry, composed into one finished video by HyperFrames (issue #29;
 * idea.md §4.2 covers the other three gates).
 *
 * Unlike the timeline gate, there's nothing to tune here — the composition is
 * deterministic from what's on disk. "Regenerate" exists anyway: it's the way
 * to pick up scenes approved since the last pass.
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
          Composes <span className="font-mono">cut.mp4</span> and the beat
          sheet into <span className="font-mono">final.mp4</span> via
          HyperFrames — a finished, publishable video, ready once approved.
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
            <Button
              variant="outline"
              onClick={onRegenerate}
              disabled={disabled}
            >
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
            video
          </AlertTitle>
          <AlertDescription>
            {composite.skipped.join(", ")} — their moment ended up cut, or its
            window overlaps a cut segment, so HyperFrames couldn't place that
            card.
          </AlertDescription>
        </Alert>
      ) : null}

      {composite === null ? (
        <p className="text-xs text-muted-foreground">
          Regenerate to compose the scenes approved so far.
        </p>
      ) : null}
    </StageSection>
  )
}
