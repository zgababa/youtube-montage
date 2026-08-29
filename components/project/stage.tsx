"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  ArrowDown01Icon,
  LockIcon,
  PauseIcon,
} from "@hugeicons/core-free-icons"

import type { StageState } from "@/lib/stages"
import type { StepStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"

interface StageProps {
  stage: StageState
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The one thing this stage is for, in the header rather than under its
   * content — `Approve cleanup` used to sit below a 26rem scroll area, which
   * meant reading the diff and acting on it were different scroll positions.
   */
  action?: React.ReactNode
  children: React.ReactNode
}

/**
 * A phase of the run and the work it produced, as one thing.
 *
 * The header *is* the pipeline row: same status icon, same live detail, same
 * progress bar the separate pipeline panel used to draw. Opening it reveals
 * what that phase produced instead of sending you to a tab named after it.
 */
export function Stage({
  stage,
  open,
  onOpenChange,
  action,
  children,
}: StageProps) {
  const locked = stage.locked !== null
  const expanded = open && !locked

  return (
    <Collapsible
      id={`stage-${stage.id}`}
      open={expanded}
      onOpenChange={onOpenChange}
      className={cn(
        // The offset clears the sticky run strip when a stage is scrolled to.
        "scroll-mt-20 rounded-xl border bg-card transition-colors",
        stage.needsYou && "border-secondary-foreground/30",
        stage.status === "failed" && "border-destructive/40",
        locked && "border-dashed bg-transparent"
      )}
    >
      <div className="flex items-center gap-3 pr-4">
        <CollapsibleTrigger
          render={
            <button
              type="button"
              disabled={locked}
              aria-label={`${open ? "Collapse" : "Expand"} ${stage.label}`}
              className={cn(
                "flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl p-4 text-left outline-none",
                "focus-visible:ring-3 focus-visible:ring-ring/30",
                locked && "cursor-default"
              )}
            />
          }
        >
          <StageIcon stage={stage} />

          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "text-sm font-medium",
                  locked && "text-muted-foreground"
                )}
              >
                {stage.label}
              </span>
              {stage.needsYou ? (
                <Badge variant="secondary">needs you</Badge>
              ) : null}
            </span>
            {/*
             * The lock reason takes the detail's place rather than adding a
             * line: a stage that can't be opened has nothing else to say.
             */}
            <span className="truncate text-xs text-muted-foreground">
              {stage.locked ?? stage.detail ?? ""}
            </span>
          </span>

          {typeof stage.progress === "number" ? (
            <Progress
              value={stage.progress}
              className="hidden w-32 shrink-0 sm:block"
            />
          ) : null}
        </CollapsibleTrigger>

        {locked ? null : action}

        {/*
         * A second trigger rather than a chevron inside the first one. The
         * stage's action is a button, so it can't live inside the trigger — and
         * a chevron that isn't the last thing in the row stops reading as
         * "this opens".
         */}
        <CollapsibleTrigger
          render={
            <button
              type="button"
              disabled={locked}
              tabIndex={-1}
              aria-hidden
              className={cn(
                "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground",
                locked && "cursor-default"
              )}
            />
          }
        >
          <HugeiconsIcon
            icon={locked ? LockIcon : ArrowDown01Icon}
            strokeWidth={2}
            className={cn(
              "size-4 transition-transform",
              !locked && !expanded && "-rotate-90"
            )}
          />
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-5 border-t p-5">
          <p className="text-xs text-muted-foreground">{stage.blurb}</p>
          {children}
          {stage.log.length > 0 ? <StageLog lines={stage.log} /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * One block of content inside a stage.
 *
 * These used to be `Card`s, each announcing a title the tab above it had
 * already said. Inside a stage the title is the stage's, so a section only
 * names itself when it's sharing the stage with another one — footage and
 * transcription hints, say — and otherwise just holds its content and the
 * button that saves it.
 */
export function StageSection({
  title,
  description,
  action,
  footer,
  children,
}: {
  title?: string
  description?: React.ReactNode
  /** Sits opposite the title — a filter switch, a copy button. */
  action?: React.ReactNode
  /** The save row: a note on the left, buttons on the right. */
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  const heading = title || description || action

  return (
    <section className="flex flex-col gap-4">
      {heading ? (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-1">
            {title ? <h3 className="text-sm font-medium">{title}</h3> : null}
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {action}
        </div>
      ) : null}

      {children}

      {footer ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {footer}
        </div>
      ) : null}
    </section>
  )
}

/**
 * What the agents said while they worked, under what they produced.
 *
 * It lived in the pipeline panel, which meant the reasoning behind a decision
 * and the decision itself were never on screen together.
 */
function StageLog({ lines }: { lines: string[] }) {
  const [open, setOpen] = React.useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button variant="ghost" size="sm" className="-ml-2 w-fit">
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              data-icon="inline-start"
              className={cn("transition-transform", !open && "-rotate-90")}
            />
            {open ? "Hide" : "Show"} log
            <span className="text-muted-foreground">({lines.length})</span>
          </Button>
        }
      />
      <CollapsibleContent>
        <ScrollArea className="mt-2 h-32 rounded-lg bg-muted/50">
          <pre className="p-3 font-mono text-xs leading-relaxed text-muted-foreground">
            {lines.join("\n")}
          </pre>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * `pending` and `success` get no icon at all — both, unlike `running`, only
 * reflect whichever action is currently streaming in the browser
 * (`lib/stages.ts` rolls up `RunStep`s that default back to "pending" the
 * moment nothing is in flight — there's nothing to reconnect to after a
 * reload any more, every action being a direct one-shot call). Reload a
 * finished project and a `success` checkmark would be lying about an action
 * that isn't running any more; the stage's actual state — done, approved,
 * needs review — is already told correctly by `detail` and the action
 * badge, which read persisted project data instead. An empty circle in that
 * spot said nothing an icon-less row doesn't already say. `suspended` stays
 * a distinct icon in the status enum even though the interactive app never
 * reaches it any more — no run is left to suspend.
 */
function StageIcon({ stage }: { stage: StageState }) {
  if (stage.status === "running") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
        <Spinner />
      </span>
    )
  }

  const icon = Icon({ status: stage.status })
  if (!icon) return null

  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center text-muted-foreground opacity-50 [&_svg]:size-4",
        stage.status === "failed" && "text-destructive opacity-100"
      )}
    >
      {icon}
    </span>
  )
}

function Icon({ status }: { status: StepStatus }) {
  if (status === "suspended")
    return <HugeiconsIcon icon={PauseIcon} strokeWidth={2} />
  if (status === "failed")
    return <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
  return null
}
