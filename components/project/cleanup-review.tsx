"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { CATEGORY_LABELS, durationLabel, timecode } from "@/lib/format"
import {
  cutCounts,
  cutSeconds,
  spansWithText,
  transcriptSeconds,
  type SpanText,
} from "@/lib/project"
import type { Project } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Highlight } from "@/components/highlight"
import { SearchInput } from "@/components/search-input"

interface CleanupReviewProps {
  project: Project
  onToggleSpan: (index: number) => void
  onApprove: () => void
  onReopen: () => void
}

/**
 * The diff. Kept text reads normally; cut text is struck through and dimmed.
 *
 * Nothing here is prose the model wrote — every word is a transcript word, and
 * hiding the cuts *is* the clean script (idea.md §3). The failure mode this
 * screen exists to catch is cleanup sanding off deliberate repetition,
 * callbacks, and pauses, so any cut can be flipped back before approval.
 */
export function CleanupReview({
  project,
  onToggleSpan,
  onApprove,
  onReopen,
}: CleanupReviewProps) {
  const [hideCuts, setHideCuts] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const spans = React.useMemo(
    () => spansWithText(project.spans, project.transcript.words),
    [project.spans, project.transcript.words]
  )

  // While searching, the diff narrows to the spans that contain the phrase —
  // reading order is preserved, so the hits still sit in script order.
  const needle = query.trim().toLowerCase()
  const visible = React.useMemo(() => {
    if (!needle) return spans
    return spans.filter((span) => span.text.toLowerCase().includes(needle))
  }, [spans, needle])

  const counts = React.useMemo(() => cutCounts(project.spans), [project.spans])
  const removed = cutSeconds(project.spans)
  const total = transcriptSeconds(project.spans)
  const approved = project.cleanupApprovedAt !== null

  return (
    <Card id="cleanup">
      <CardHeader>
        <CardTitle>Transcript cleanup</CardTitle>
        <CardDescription>
          {durationLabel(removed)} removed from {durationLabel(total)} ·{" "}
          {project.transcript.words.length} words with timestamps
        </CardDescription>
        <CardAction>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="hide-cuts">Hide cuts</FieldLabel>
            <Switch
              id="hide-cuts"
              checked={hideCuts}
              onCheckedChange={setHideCuts}
            />
          </Field>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {counts.map(([category, count]) => (
            <Badge key={category} variant="outline">
              {CATEGORY_LABELS[category]}: {count}
            </Badge>
          ))}
          {counts.length === 0 ? (
            <Badge variant="outline">no cuts proposed</Badge>
          ) : null}
        </div>

        {!approved ? (
          <Alert>
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
            <AlertTitle>Check for deliberate repetition</AlertTitle>
            <AlertDescription>
              Cleanup will happily cut a callback, a beat, or a repeated phrase
              that was doing work. Click any struck-through span to keep it.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            className="max-w-sm"
            label="Search transcript"
            placeholder="Find a phrase in the transcript…"
            value={query}
            onValueChange={setQuery}
          />
          {needle ? (
            <span className="text-xs text-muted-foreground">
              {visible.length} of {spans.length} spans
            </span>
          ) : null}
        </div>

        <ScrollArea className="h-[26rem] rounded-xl border">
          <div className="p-5 text-[0.95rem] leading-[1.9]">
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing in the transcript matches &ldquo;{query}&rdquo;.
              </p>
            ) : (
              visible.map((span) => (
                <SpanToken
                  key={`${span.start}-${span.end}`}
                  span={span}
                  query={query}
                  hidden={hideCuts && span.action === "cut"}
                  onToggle={() => onToggleSpan(span.index)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>

      <CardFooter className="justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {approved
            ? `Approved ${new Date(project.cleanupApprovedAt!).toLocaleString()} — steps 5 and up are unblocked.`
            : "Approving resumes the suspended workflow with the spans as they stand."}
        </p>
        <div className="flex items-center gap-2">
          {approved ? (
            <Button variant="ghost" onClick={onReopen}>
              Reopen
            </Button>
          ) : null}
          <Button onClick={onApprove} disabled={approved}>
            <HugeiconsIcon
              icon={Tick02Icon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            {approved ? "Cleanup approved" : "Approve cleanup"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}

function SpanToken({
  span,
  query,
  hidden,
  onToggle,
}: {
  span: SpanText
  query: string
  hidden: boolean
  onToggle: () => void
}) {
  if (hidden || span.text.length === 0) return null

  if (span.action === "keep") {
    return (
      <span>
        <Highlight text={span.text} query={query} />{" "}
      </span>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              "cursor-pointer rounded-sm text-muted-foreground/60 line-through decoration-1 underline-offset-2 transition-colors",
              "hover:bg-muted hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
            )}
          />
        }
      >
        <Highlight text={span.text} query={query} />
      </TooltipTrigger>{" "}
      <TooltipContent>
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">
            {timecode(span.start)}–{timecode(span.end)} ·{" "}
            {CATEGORY_LABELS[span.category ?? "filler"]}
          </span>
          {span.reason ? <span>{span.reason}</span> : null}
          <span className="text-muted-foreground">Click to keep</span>
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
