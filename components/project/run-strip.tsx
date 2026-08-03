"use client"

import type { StageId, StageState } from "@/lib/stages"
import type { Run, StepStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * The whole run in one line, pinned to the top of the page.
 *
 * All that survives of the pipeline panel. The panel spent 500px listing steps
 * whose results were in a different tab; the only part of it worth keeping was
 * the glance — how far along, what's happening now, is anything broken. One
 * tick per step, grouped by the stage that owns it, so clicking a group is the
 * same as opening the stage that produced it.
 */
export function RunStrip({
  run,
  stages,
  onCancel,
  onJump,
}: {
  run: Run | null
  stages: StageState[]
  onCancel: () => void
  onJump: (id: StageId) => void
}) {
  const steps = stages.flatMap((stage) => stage.runSteps)
  const done = steps.filter((step) => step.status === "success").length
  const working = steps.find(
    (step) => step.status === "running" || step.status === "suspended"
  )

  return (
    <div className="sticky top-0 z-20 -mt-2 pt-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card/85 px-4 py-2.5 backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {run?.status === "running" ? (
            <Spinner className="size-4 shrink-0 text-muted-foreground" />
          ) : null}

          <span className="min-w-0 truncate text-sm">
            {run === null ? (
              <span className="text-muted-foreground">
                Not run yet — start the pipeline, or drive it from Mastra Studio
                on port 4111.
              </span>
            ) : (
              <>
                <span className="font-medium tabular-nums">
                  {done} of {steps.length}
                </span>
                {working ? (
                  <span className="text-muted-foreground">
                    {" · "}
                    {working.label}
                    {working.detail ? ` · ${working.detail}` : ""}
                  </span>
                ) : null}
              </>
            )}
          </span>

          {run?.status === "failed" ? (
            <Badge variant="destructive">failed</Badge>
          ) : null}
          {run?.suspendedOn ? (
            <Badge variant="secondary">needs you</Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {stages.map((stage) => (
            <Tooltip key={stage.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => onJump(stage.id)}
                    aria-label={`Open ${stage.label}`}
                    className="flex cursor-pointer items-center gap-0.5 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                  />
                }
              >
                {stage.runSteps.map((step) => (
                  <span
                    key={step.id}
                    className={cn("h-1.5 w-4 rounded-full", tick(step.status))}
                  />
                ))}
              </TooltipTrigger>
              <TooltipContent>
                {stage.label} · {stage.status}
              </TooltipContent>
            </Tooltip>
          ))}

          {/* Nothing to cancel before the first run — and one fewer control. */}
          {run ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={run.status !== "running"}
            >
              Cancel run
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function tick(status: StepStatus) {
  switch (status) {
    case "success":
      return "bg-primary"
    case "running":
      return "bg-primary/50 animate-pulse"
    case "suspended":
      return "bg-secondary-foreground/40"
    case "failed":
      return "bg-destructive"
    default:
      return "bg-border"
  }
}
