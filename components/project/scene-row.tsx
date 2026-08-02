"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  Analytics01Icon,
  Cancel01Icon,
  FileExportIcon,
  FlowIcon,
  Layers01Icon,
  PlayIcon,
  Refresh01Icon,
  SourceCodeIcon,
  SparklesIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"

import {
  SCENE_STATUS_LABELS,
  durationLabel,
  sceneStatusVariant,
  timecode,
} from "@/lib/format"
import { overrunsWindow } from "@/lib/project"
import { useInView } from "@/hooks/use-in-view"
import type { Scene, SceneDraft, SceneType } from "@/lib/types"
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
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Highlight } from "@/components/highlight"
import { SceneFrame, type SceneBackdrop } from "@/components/scene/scene-frame"
import { SceneDraftFrame } from "@/components/scene/scene-draft-frame"
import { RegenerateDialog } from "@/components/project/regenerate-dialog"

const TYPE_ICONS: Record<SceneType, typeof FlowIcon> = {
  diagram: FlowIcon,
  code: SourceCodeIcon,
  data: Analytics01Icon,
  process: Layers01Icon,
  concept: SparklesIcon,
}

interface SceneRowProps {
  scene: Scene
  backdrop: SceneBackdrop
  /** Set only while this scene is being written, and only during a live run. */
  draft?: SceneDraft
  /** Active scene search, highlighted in the covered line and intent. */
  query?: string
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onRegenerate: (id: string, note: string) => void
  onExport: (id: string) => void
}

export function SceneRow({
  scene,
  backdrop,
  draft,
  query = "",
  onApprove,
  onReject,
  onRegenerate,
  onExport,
}: SceneRowProps) {
  const [runKey, setRunKey] = React.useState(0)
  const [mode, setMode] = React.useState<"play" | "scrub">("play")
  const [playheadMs, setPlayheadMs] = React.useState(0)
  const [measuredSec, setMeasuredSec] = React.useState(
    scene.measuredDurationSec ?? 0
  )
  const startedAt = React.useRef<number | null>(null)
  // No margin: a scene preview is a live 1920x1080 document, so only the ones
  // actually on screen stay mounted.
  const { ref: viewRef, inView } = useInView<HTMLDivElement>("0px")

  const durationMs = Math.max(measuredSec, 0.1) * 1000
  const overruns = overrunsWindow({
    ...scene,
    measuredDurationSec: measuredSec,
  })
  const TypeIcon = TYPE_ICONS[scene.type]

  const onReady = React.useCallback((durationSec: number) => {
    if (durationSec > 0) setMeasuredSec(durationSec)
    startedAt.current = performance.now()
  }, [])

  // Parent-side playhead. The scene itself never uses a clock — this only
  // moves the slider so the readout matches what the iframe is showing.
  React.useEffect(() => {
    if (mode !== "play" || !inView) return
    let frame = 0

    const tick = () => {
      if (startedAt.current !== null) {
        const elapsed = performance.now() - startedAt.current
        setPlayheadMs(Math.min(elapsed, durationMs))
        if (elapsed >= durationMs) return
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [mode, durationMs, runKey, inView])

  function replay() {
    startedAt.current = null
    setPlayheadMs(0)
    setMode("play")
    setRunKey((key) => key + 1)
  }

  function scrub(ms: number) {
    setMode("scrub")
    setPlayheadMs(ms)
  }

  return (
    <Card id={scene.id}>
      <CardHeader>
        <CardDescription className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="text-foreground">
            {timecode(scene.scriptStart)} → {timecode(scene.scriptEnd)}
          </span>
          <Separator orientation="vertical" className="h-3" />
          <span>{durationLabel(scene.windowSec)} window</span>
          <Separator orientation="vertical" className="h-3" />
          <span className="truncate">{scene.sourceFile}</span>
        </CardDescription>
        {/* The line being covered is what gets scanned while editing — it leads. */}
        <CardTitle className="text-base leading-snug font-medium text-balance">
          &ldquo;
          <Highlight text={scene.coversLine} query={query} />
          &rdquo;
        </CardTitle>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="outline">
            <HugeiconsIcon icon={TypeIcon} strokeWidth={2} />
            {scene.type}
          </Badge>
          <Badge variant={sceneStatusVariant(scene.status)}>
            {scene.status === "generating" || scene.status === "exporting" ? (
              <Spinner />
            ) : null}
            {SCENE_STATUS_LABELS[scene.status]}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3" ref={viewRef}>
          {scene.html ? (
            <>
              {inView ? (
                <SceneFrame
                  key={runKey}
                  html={scene.html}
                  seekMs={mode === "scrub" ? playheadMs : null}
                  backdrop={backdrop}
                  onReady={onReady}
                  title={`Preview of ${scene.id}`}
                />
              ) : (
                <Skeleton className="aspect-video w-full rounded-xl" />
              )}
              <div className="flex items-center gap-3">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="Replay"
                        onClick={replay}
                      >
                        <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
                      </Button>
                    }
                  />
                  <TooltipContent>Replay from the first frame</TooltipContent>
                </Tooltip>
                <Slider
                  value={playheadMs}
                  min={0}
                  max={durationMs}
                  step={durationMs / 240}
                  onValueChange={(value) =>
                    scrub(Array.isArray(value) ? value[0] : value)
                  }
                  aria-label="Scrub scene"
                />
                <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  {(playheadMs / 1000).toFixed(2)}s
                </span>
              </div>
            </>
          ) : scene.status === "failed" ? (
            <Alert variant="destructive">
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
              <AlertTitle>Generation failed</AlertTitle>
              <AlertDescription>
                {scene.error ??
                  "The scene step returned no HTML. The rest of the run was unaffected."}
              </AlertDescription>
            </Alert>
          ) : (
            /*
             * Not finished, and not failed. The absence of HTML used to be read
             * as failure here, which meant every scene accused the run of
             * having broken for the whole minute it was being written.
             */
            <>
              {inView && draft ? (
                // Keyed by attempt: a repair is a new document, and the frame
                // it streams into can only be written forwards.
                <SceneDraftFrame
                  key={draft.attempt}
                  html={draft.html}
                  backdrop={backdrop}
                  title={`Draft of ${scene.id}`}
                />
              ) : (
                <Skeleton className="aspect-video w-full rounded-xl" />
              )}
              <p className="text-xs text-muted-foreground">
                {scene.status === "generating"
                  ? "Writing — it becomes replayable once it passes validation."
                  : "Queued — scenes are generated three at a time."}
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Intent
            </span>
            <p className="text-sm">
              <Highlight text={scene.intent} query={query} />
            </p>
          </div>

          {scene.note ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Last regenerate note
              </span>
              <p className="text-sm">{scene.note}</p>
            </div>
          ) : null}

          <Separator />

          <div className="flex flex-col gap-2 text-sm">
            <Row label="Animation">
              <span
                className={cn(
                  "font-mono tabular-nums",
                  overruns && "text-destructive"
                )}
              >
                {measuredSec > 0 ? durationLabel(measuredSec) : "—"}
              </span>
            </Row>
            <Row label="Window">
              <span className="font-mono text-muted-foreground tabular-nums">
                {durationLabel(scene.windowSec)}
              </span>
            </Row>
            <Row label="Export">
              <span className="truncate font-mono text-xs text-muted-foreground">
                {scene.exportPath ?? "not exported"}
              </span>
            </Row>
          </div>

          {overruns ? (
            <Alert variant="destructive">
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
              <AlertTitle>Overruns its window</AlertTitle>
              <AlertDescription>
                {durationLabel(measuredSec)} of animation in a{" "}
                {durationLabel(scene.windowSec)} gap. Regenerate with a shorter
                target, or the tail lands over the next line.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CardContent>

      <CardFooter className="flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => onApprove(scene.id)}
          disabled={
            scene.html === null ||
            scene.status === "approved" ||
            scene.status === "exported"
          }
        >
          <HugeiconsIcon
            icon={Tick02Icon}
            strokeWidth={2}
            data-icon="inline-start"
          />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onReject(scene.id)}
          disabled={scene.status === "rejected" || scene.html === null}
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            strokeWidth={2}
            data-icon="inline-start"
          />
          Reject
        </Button>
        <RegenerateDialog
          scene={scene}
          onSubmit={(note) => onRegenerate(scene.id, note)}
          trigger={
            <Button size="sm" variant="outline">
              <HugeiconsIcon
                icon={Refresh01Icon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              Regenerate
            </Button>
          }
        />
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          onClick={() => onExport(scene.id)}
          disabled={scene.status !== "approved"}
        >
          <HugeiconsIcon
            icon={FileExportIcon}
            strokeWidth={2}
            data-icon="inline-start"
          />
          Export ProRes
        </Button>
      </CardFooter>
    </Card>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
