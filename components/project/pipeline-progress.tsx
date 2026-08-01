"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  MinusSignIcon,
  PauseIcon,
} from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"
import type { Run, RunStep } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Progress, ProgressValue } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * Run progress, rendered from `run.stream()` events (idea.md §4.3). There is no
 * custom job registry behind this — the steps are the workflow's own steps.
 *
 * Collapsed to a single line by default: nine steps at full height pushed the
 * review tabs below the fold, and the review tabs are the actual work. The
 * status strip keeps the run readable at a glance without the expansion.
 */
export function PipelineProgress({
  run,
  onCancel,
}: {
  run: Run | null
  onCancel: () => void
}) {
  // An active or broken run is worth the vertical space; a parked one isn't.
  const [open, setOpen] = React.useState(
    run?.status === "running" || run?.status === "failed"
  )

  if (!run) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>
            This project hasn&apos;t been run yet. Start it here, or drive it
            from Mastra Studio on port 4111.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const done = run.steps.filter((step) => step.status === "success").length
  const active = run.steps.find(
    (step) => step.status === "running" || step.status === "suspended"
  )

  return (
    <Card size="sm">
      <Collapsible open={open} onOpenChange={setOpen}>
        {/*
         * `gap-0`: CardAction spans two grid rows, and with no CardDescription
         * the second row is empty — its row gap would otherwise add 6px of
         * dead space under the controls.
         */}
        <CardHeader className="items-center gap-0">
          <CardTitle>
            <CollapsibleTrigger
              render={
                <button
                  type="button"
                  aria-label={
                    open ? "Hide pipeline steps" : "Show pipeline steps"
                  }
                  // h-8 matches the Cancel run button. CardHeader's grid is
                  // `auto-rows-min`, so without it the row is sized to the
                  // 24px title and the taller button hangs 8px past the
                  // bottom — the whole row reads as sitting high.
                  className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                />
              }
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                strokeWidth={2}
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  !open && "-rotate-90"
                )}
              />
              Pipeline
              <span className="min-w-0 truncate text-sm font-normal text-muted-foreground">
                {done} of {run.steps.length}
                {active ? ` · ${active.label}` : ""}
              </span>
              {run.suspendedOn ? (
                <Badge variant="secondary">needs you</Badge>
              ) : null}
            </CollapsibleTrigger>
          </CardTitle>

          <CardAction className="flex items-center gap-4">
            <StatusStrip steps={run.steps} />
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={run.status !== "running"}
            >
              Cancel run
            </Button>
          </CardAction>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="flex flex-col gap-1 pt-4">
            {run.steps.map((step, index) => (
              <React.Fragment key={step.id}>
                {index > 0 ? <Separator /> : null}
                <StepRow step={step} />
              </React.Fragment>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

/** Nine ticks, one per step — the whole run readable without expanding it. */
function StatusStrip({ steps }: { steps: RunStep[] }) {
  return (
    <div className="hidden shrink-0 items-center gap-1 sm:flex">
      {steps.map((step) => (
        <Tooltip key={step.id}>
          <TooltipTrigger
            render={<span />}
            className={cn(
              "h-1.5 w-5 rounded-full",
              step.status === "success" && "bg-primary",
              step.status === "running" && "bg-primary/50",
              step.status === "suspended" && "bg-secondary-foreground/40",
              step.status === "failed" && "bg-destructive",
              step.status === "pending" && "bg-border"
            )}
          />
          <TooltipContent>
            {step.label} · {step.status}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

function StepIcon({ status }: { status: RunStep["status"] }) {
  if (status === "running") return <Spinner />
  if (status === "success")
    return <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
  if (status === "suspended")
    return <HugeiconsIcon icon={PauseIcon} strokeWidth={2} />
  if (status === "failed")
    return (
      <HugeiconsIcon
        icon={Alert02Icon}
        strokeWidth={2}
        className="text-destructive"
      />
    )
  return <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} />
}

function StepRow({ step }: { step: RunStep }) {
  const hasLog = step.log.length > 0

  return (
    <Collapsible className="py-1">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4",
            step.status === "success" && "text-primary",
            step.status === "pending" && "opacity-50"
          )}
        >
          <StepIcon status={step.status} />
        </span>

        <span
          className={cn(
            "w-40 shrink-0 text-sm font-medium",
            step.status === "pending" && "text-muted-foreground"
          )}
        >
          {step.label}
        </span>

        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {step.detail ?? (step.status === "pending" ? "waiting" : "")}
        </span>

        {typeof step.progress === "number" ? (
          <Progress value={step.progress} className="w-40 shrink-0">
            <ProgressValue />
          </Progress>
        ) : null}

        {step.status === "suspended" ? (
          <Badge variant="secondary">needs you</Badge>
        ) : null}

        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Toggle log"
              disabled={!hasLog}
            >
              <HugeiconsIcon
                icon={hasLog ? ArrowDown01Icon : MinusSignIcon}
                strokeWidth={2}
              />
            </Button>
          }
        />
      </div>

      <CollapsibleContent>
        <ScrollArea className="mt-2 ml-8 h-28 rounded-lg bg-muted/50">
          <pre className="p-3 font-mono text-xs leading-relaxed text-muted-foreground">
            {step.log.join("\n")}
          </pre>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  )
}
