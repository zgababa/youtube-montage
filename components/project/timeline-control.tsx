"use client"

import * as React from "react"

import { durationLabel } from "@/lib/format"
import type { Project } from "@/lib/types"
import type { PipelineDataParts } from "@/src/mastra/stream/contract"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * One always-available control for what used to be two workflow gates —
 * "Timeline export" and "Timeline composite" (ADR 0009). Both are
 * deterministic and cheap to write, so there's nothing to guess about
 * project state here: one click always redoes both, from whatever's on
 * disk right now, whether or not a pipeline run happens to be active.
 */
export function TimelineControl({
  project,
  timeline,
  composite,
  onUpdate,
}: {
  project: Project
  timeline: PipelineDataParts["fcpxml"] | null
  composite: PipelineDataParts["composite"] | null
  onUpdate: (maxSilenceSec: number) => Promise<void>
}) {
  const [showSettings, setShowSettings] = React.useState(false)
  const [draft, setDraft] = React.useState(project.maxSilenceSec)
  const [pending, setPending] = React.useState(false)

  function update() {
    setPending(true)
    onUpdate(draft).finally(() => setPending(false))
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={update} disabled={pending}>
            {pending ? "Updating…" : "Update timeline"}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Silence cap settings"
            onClick={() => setShowSettings((current) => !current)}
          >
            ⚙
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          {timeline
            ? `${timeline.runsCount} clip${timeline.runsCount === 1 ? "" : "s"} · ${durationLabel(timeline.totalDurationSec)} · ${timeline.maxSilenceSec}s cap`
            : project.timelineApprovedAt
              ? `Exported · ${project.maxSilenceSec}s cap`
              : "Not exported yet"}
          {composite
            ? ` · ${composite.placedCount} composited`
            : project.compositeApprovedAt
              ? " · composited"
              : ""}
        </span>
      </div>

      {showSettings ? (
        <div className="flex items-center gap-2 border-t pt-2">
          <label htmlFor="timeline-silence-cap" className="text-xs">
            Silence cap
          </label>
          <Input
            id="timeline-silence-cap"
            type="number"
            min={0.05}
            max={2}
            step={0.05}
            value={draft}
            onChange={(event) =>
              setDraft(Number.parseFloat(event.target.value) || 0)
            }
            className="w-20 font-mono text-xs"
          />
          <span className="text-xs text-muted-foreground">
            Regenerate the longest silence kept between two kept lines of the
            same file, in seconds.
          </span>
        </div>
      ) : null}

      {composite && composite.skipped.length > 0 ? (
        <p className="text-xs text-destructive">
          {composite.skipped.length} scene
          {composite.skipped.length === 1 ? "" : "s"} didn&rsquo;t land on the
          cut timeline — still exported, place manually from the shot list.
        </p>
      ) : null}
    </div>
  )
}
