"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  Search01Icon,
  Video01Icon,
} from "@hugeicons/core-free-icons"

import { sceneCounts } from "@/lib/project"
import type { Project, SceneDraft } from "@/lib/types"
import type { SceneDecision } from "@/src/mastra/stream/contract"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SceneTile } from "@/components/project/scene-tile"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SearchInput } from "@/components/search-input"
import type { SceneBackdrop } from "@/components/scene/scene-frame"
import { SceneRow } from "@/components/project/scene-row"

/** One expanded scene spans the whole grid, so the row it opens into is full width. */
const FULL_WIDTH = "sm:col-span-2 xl:col-span-3"

const BACKDROPS: { value: SceneBackdrop; label: string }[] = [
  { value: "checker", label: "Alpha" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
]

interface SceneListProps {
  project: Project
  /** Documents still being written, keyed by scene id. Empty outside a run. */
  drafts?: Record<string, SceneDraft>
  /**
   * Decisions made but not yet sent — keyed by scene id. A scene with an
   * entry here looks unchanged on disk until "Send back" is clicked; the tile
   * and row need this to show that a decision is queued rather than lost.
   */
  decisions?: Record<string, SceneDecision>
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onRegenerate: (id: string, note: string, model: string) => void
}

/**
 * Sorted by timestamp so the list reads top-to-bottom as a shot list
 * (idea.md §10).
 */
export function SceneList({
  project,
  drafts = {},
  decisions = {},
  onApprove,
  onReject,
  onRegenerate,
}: SceneListProps) {
  const [backdrop, setBackdrop] = React.useState<SceneBackdrop>("checker")
  const [query, setQuery] = React.useState("")
  /** At most one scene is open at a time — two full rows is the old scrolling. */
  const [expanded, setExpanded] = React.useState<string | null>(null)

  const scenes = React.useMemo(
    () => [...project.scenes].sort((a, b) => a.scriptStart - b.scriptStart),
    [project.scenes]
  )
  const counts = sceneCounts(scenes)

  // The covered line is what gets scanned while editing, so it's what search
  // is really for — the rest are there so "diagram" or "scene_06" also work.
  const matches = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return scenes
    return scenes.filter((scene) =>
      [
        scene.coversLine,
        scene.intent,
        scene.id,
        scene.type,
        scene.sourceFile,
        scene.note ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    )
  }, [scenes, query])

  if (project.cleanupApprovedAt === null) {
    return (
      <Alert>
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
        <AlertTitle>Scene placement is gated on the cleanup diff</AlertTitle>
        <AlertDescription>
          Approve the transcript cleanup first — the scenario agent reads the
          approved script, not the raw transcript.
        </AlertDescription>
      </Alert>
    )
  }

  if (scenes.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Video01Icon} strokeWidth={1.8} />
          </EmptyMedia>
          <EmptyTitle>No scenes yet</EmptyTitle>
          <EmptyDescription>
            Run the pipeline to place scenes against the approved script.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{counts.total} scenes</Badge>
          <Badge variant={counts.approved > 0 ? "default" : "outline"}>
            {counts.approved} approved
          </Badge>
          <Badge variant="outline">{counts.exported} exported</Badge>
          {counts.overrunning > 0 ? (
            <Badge variant="destructive">
              {counts.overrunning} overrun their window
            </Badge>
          ) : null}
          {counts.failed > 0 ? (
            <Badge variant="destructive">{counts.failed} failed</Badge>
          ) : null}
        </div>

        <Field orientation="horizontal" className="w-auto">
          <FieldLabel className="text-xs text-muted-foreground">
            Preview over
          </FieldLabel>
          <ToggleGroup
            size="sm"
            value={[backdrop]}
            onValueChange={(value) => {
              const next = value[0] as SceneBackdrop | undefined
              if (next) setBackdrop(next)
            }}
          >
            {BACKDROPS.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="max-w-sm"
          label="Search scenes"
          placeholder="Search the lines these scenes cover…"
          value={query}
          onValueChange={setQuery}
        />
        {query ? (
          <span className="text-xs text-muted-foreground">
            {matches.length} of {scenes.length} scenes
          </span>
        ) : (
          <p className="text-xs text-muted-foreground">
            Click a scene to scrub it, read its timings, or send it back with a
            note.
          </p>
        )}
      </div>

      {matches.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Search01Icon} strokeWidth={1.8} />
            </EmptyMedia>
            <EmptyTitle>No scenes match “{query}”</EmptyTitle>
            <EmptyDescription>
              Search covers the script line, intent, scene id, type, and source
              file.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {matches.map((scene) =>
            scene.id === expanded ? (
              // Spanning the whole grid rather than opening a dialog: the
              // scene stays where it was in script order, and closing it puts
              // you back in the same place instead of behind an overlay.
              <SceneRow
                key={scene.id}
                className={FULL_WIDTH}
                scene={scene}
                backdrop={backdrop}
                draft={drafts[scene.id]}
                decision={decisions[scene.id]}
                query={query}
                onCollapse={() => setExpanded(null)}
                onApprove={onApprove}
                onReject={onReject}
                onRegenerate={onRegenerate}
              />
            ) : (
              <SceneTile
                key={scene.id}
                scene={scene}
                backdrop={backdrop}
                draft={drafts[scene.id]}
                decision={decisions[scene.id]}
                query={query}
                onApprove={onApprove}
                onReject={onReject}
                onExpand={() => setExpanded(scene.id)}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}
