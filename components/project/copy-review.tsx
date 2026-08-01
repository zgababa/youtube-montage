"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, TextFontIcon } from "@hugeicons/core-free-icons"

import type { ProjectCopy } from "@/lib/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import { CopyButton } from "@/components/copy-button"

/** Written from the approved script, never the raw transcript (idea.md §4). */
export function CopyReview({ copy }: { copy: ProjectCopy | null }) {
  if (!copy) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={TextFontIcon} strokeWidth={1.8} />
          </EmptyMedia>
          <EmptyTitle>No copy yet</EmptyTitle>
          <EmptyDescription>
            The copy step runs after the export step, so it describes what
            actually shipped.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const chaptersText = copy.youtube.chapters
    .map((chapter) => `${chapter.timecode} ${chapter.label}`)
    .join("\n")

  return (
    <div className="flex flex-col gap-5">
      <Alert>
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
        <AlertTitle>Generated from the approved script</AlertTitle>
        <AlertDescription>
          Cut spans were excluded, so nothing here describes something you
          removed.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>YouTube</CardTitle>
          <CardDescription>
            Title options, description, chapters, tags.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <SectionLabel>Titles</SectionLabel>
            <ItemGroup className="gap-1">
              {copy.youtube.title.map((title) => (
                <Item key={title} variant="muted" size="sm">
                  <ItemContent>
                    <ItemTitle className="line-clamp-none">{title}</ItemTitle>
                  </ItemContent>
                  <CopyButton value={title} label="Copy title" />
                </Item>
              ))}
            </ItemGroup>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <SectionLabel
              action={
                <CopyButton
                  value={copy.youtube.description}
                  label="Copy description"
                />
              }
            >
              Description
            </SectionLabel>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {copy.youtube.description}
            </p>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <SectionLabel
              action={<CopyButton value={chaptersText} label="Copy chapters" />}
            >
              Chapters
            </SectionLabel>
            <div className="flex flex-col gap-1 font-mono text-sm">
              {copy.youtube.chapters.map((chapter) => (
                <div key={chapter.timecode} className="flex gap-4">
                  <span className="text-muted-foreground tabular-nums">
                    {chapter.timecode}
                  </span>
                  <span>{chapter.label}</span>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <SectionLabel
              action={
                <CopyButton
                  value={copy.youtube.tags.join(", ")}
                  label="Copy tags"
                />
              }
            >
              Tags
            </SectionLabel>
            <div className="flex flex-wrap gap-2">
              {copy.youtube.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          </section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Twitter</CardTitle>
          <CardDescription>
            Hook, thread, and a standalone insight.
          </CardDescription>
          <CardAction>
            <CopyButton
              value={[copy.twitter.hook, ...copy.twitter.thread].join("\n\n")}
              label="Copy whole thread"
              size="sm"
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <SectionLabel
              action={
                <CopyButton value={copy.twitter.hook} label="Copy hook" />
              }
            >
              Hook
            </SectionLabel>
            <p className="text-sm leading-relaxed">{copy.twitter.hook}</p>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <SectionLabel>Thread</SectionLabel>
            <ItemGroup className="gap-1">
              {copy.twitter.thread.map((tweet, index) => (
                <Item key={tweet} variant="muted" size="sm">
                  <ItemContent>
                    <ItemTitle className="line-clamp-none font-normal">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        {index + 2}/
                      </span>
                      {tweet}
                    </ItemTitle>
                  </ItemContent>
                  <CopyButton value={tweet} label="Copy tweet" />
                </Item>
              ))}
            </ItemGroup>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <SectionLabel
              action={
                <CopyButton
                  value={copy.twitter.standalone}
                  label="Copy tweet"
                />
              }
            >
              Standalone
            </SectionLabel>
            <p className="text-sm leading-relaxed">{copy.twitter.standalone}</p>
          </section>
        </CardContent>
      </Card>
    </div>
  )
}

function SectionLabel({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-8 items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        {children}
      </span>
      {action}
    </div>
  )
}
