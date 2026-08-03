"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  Cancel01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"

import { SCENE_STATUS_LABELS, sceneStatusVariant, timecode } from "@/lib/format"
import { overrunsWindow } from "@/lib/project"
import { useInView } from "@/hooks/use-in-view"
import type { Scene, SceneDraft } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Highlight } from "@/components/highlight"
import { SceneFrame, type SceneBackdrop } from "@/components/scene/scene-frame"
import { SceneDraftFrame } from "@/components/scene/scene-draft-frame"

interface SceneTileProps {
  scene: Scene
  backdrop: SceneBackdrop
  /** Set only while this scene is being written, and only during a live run. */
  draft?: SceneDraft
  query?: string
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onExpand: () => void
}

/**
 * One scene, at the size you review twelve of them.
 *
 * A dozen full-width rows is about twelve screens of scrolling, and reviewing
 * is mostly a glance — does this look right against the line it covers. So the
 * tile carries the preview, the line, and the two decisions, and everything
 * that needs room (scrubber, timings, export path, regenerate) lives in the
 * expanded row one click away.
 *
 * The preview keeps playing: it's a live document, not a thumbnail, so what you
 * judge is the animation rather than its first frame.
 */
export function SceneTile({
  scene,
  backdrop,
  draft,
  query = "",
  onApprove,
  onReject,
  onExpand,
}: SceneTileProps) {
  // No margin: each preview is a live 1920x1080 document, so only the tiles
  // actually on screen stay mounted.
  const { ref, inView } = useInView<HTMLDivElement>("0px")

  const decided = scene.status === "approved" || scene.status === "exported"
  const overruns = overrunsWindow(scene)

  return (
    <div
      id={scene.id}
      ref={ref}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card transition-colors",
        decided && "border-primary/40",
        scene.status === "rejected" && "border-destructive/40"
      )}
    >
      <div className="relative">
        <Preview
          scene={scene}
          draft={draft}
          backdrop={backdrop}
          show={inView}
        />

        {/*
         * Over the iframe rather than around it: a sandboxed frame swallows
         * clicks, so the tile needs its own surface to be clickable at all.
         */}
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Open ${scene.id}`}
          className="absolute inset-0 cursor-pointer rounded-t-xl transition outline-none ring-inset hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/40"
        />

        <Badge
          variant={sceneStatusVariant(scene.status)}
          className="pointer-events-none absolute top-2 right-2"
        >
          {scene.status === "generating" || scene.status === "exporting" ? (
            <Spinner />
          ) : null}
          {SCENE_STATUS_LABELS[scene.status]}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span>{timecode(scene.scriptStart)}</span>
          <span>·</span>
          <span>{scene.type}</span>
          {overruns ? (
            <Badge variant="destructive" className="ml-auto">
              overruns
            </Badge>
          ) : null}
        </div>

        <p className="line-clamp-2 flex-1 text-sm leading-snug text-balance">
          &ldquo;
          <Highlight text={scene.coversLine} query={query} />
          &rdquo;
        </p>

        <div className="flex items-center gap-1.5 pt-1">
          <Action
            label="Approve"
            icon={Tick02Icon}
            variant={decided ? "default" : "outline"}
            disabled={scene.html === null || decided}
            onClick={() => onApprove(scene.id)}
          />
          <Action
            label="Reject"
            icon={Cancel01Icon}
            variant="outline"
            disabled={scene.html === null || scene.status === "rejected"}
            onClick={() => onReject(scene.id)}
          />
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={onExpand}
          >
            Details
          </Button>
        </div>
      </div>
    </div>
  )
}

function Preview({
  scene,
  draft,
  backdrop,
  show,
}: {
  scene: Scene
  draft?: SceneDraft
  backdrop: SceneBackdrop
  show: boolean
}) {
  if (scene.html && show) {
    return (
      <SceneFrame
        html={scene.html}
        backdrop={backdrop}
        title={`Preview of ${scene.id}`}
      />
    )
  }

  if (scene.status === "failed") {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-destructive/5 px-4 text-center">
        <HugeiconsIcon
          icon={Alert02Icon}
          strokeWidth={2}
          className="size-5 text-destructive"
        />
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {scene.error ?? "Generation failed."}
        </p>
      </div>
    )
  }

  // Not finished and not failed — the document is still being written, and the
  // deltas are enough to draw it.
  if (draft && show) {
    return (
      <SceneDraftFrame
        key={draft.attempt}
        html={draft.html}
        backdrop={backdrop}
        title={`Draft of ${scene.id}`}
      />
    )
  }

  return <Skeleton className="aspect-video w-full rounded-none" />
}

function Action({
  label,
  icon,
  variant,
  disabled,
  onClick,
}: {
  label: string
  icon: typeof Tick02Icon
  variant: "default" | "outline"
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            <HugeiconsIcon icon={icon} strokeWidth={2} />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
