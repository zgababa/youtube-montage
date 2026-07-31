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

/**
 * Run progress, rendered from `run.stream()` events (idea.md §4.3). There is no
 * custom job registry behind this — the steps are the workflow's own steps.
 */
export function PipelineProgress({
  run,
  onCancel,
}: {
  run: Run | null
  onCancel: () => void
}) {
  if (!run) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>
            This project hasn&apos;t been run yet. Start it here, or drive it from
            Mastra Studio on port 4111.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const done = run.steps.filter((step) => step.status === "success").length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline</CardTitle>
        <CardDescription>
          {done} of {run.steps.length} steps complete
          {run.suspendedOn ? ` · suspended on ${run.suspendedOn}` : ""}
        </CardDescription>
        <CardAction>
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
      <CardContent className="flex flex-col gap-1">
        {run.steps.map((step, index) => (
          <React.Fragment key={step.id}>
            {index > 0 ? <Separator /> : null}
            <StepRow step={step} />
          </React.Fragment>
        ))}
      </CardContent>
    </Card>
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
    <Collapsible className="py-2">
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
