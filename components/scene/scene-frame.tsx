"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  SCENE_MESSAGE_TARGET,
  withSceneController,
  type SceneMessage,
} from "@/lib/scene-controller"

export type SceneBackdrop = "checker" | "dark" | "light"

const BACKDROP_CLASS: Record<SceneBackdrop, string> = {
  checker: "scene-backdrop-checker",
  dark: "scene-backdrop-dark",
  light: "scene-backdrop-light",
}

interface SceneFrameProps {
  html: string
  /**
   * Seek target in milliseconds. `null` lets the scene play from load — which
   * is how replay works: remount the frame (change its `key`) rather than
   * fighting the animations.
   */
  seekMs?: number | null
  backdrop?: SceneBackdrop
  onReady?: (durationSec: number) => void
  className?: string
  title: string
}

/**
 * The deliberate exception to "shadcn components only" (idea.md §10): the
 * iframe stays a plain element. Everything around it is a shadcn `Card`.
 *
 * The scene is authored for a 1920x1080 frame, so the iframe is sized at
 * 1920x1080 and scaled down — rendering into a small viewport instead would
 * change the layout the export produces.
 */
export function SceneFrame({
  html,
  seekMs = null,
  backdrop = "checker",
  onReady,
  className,
  title,
}: SceneFrameProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const frameRef = React.useRef<HTMLIFrameElement>(null)
  const [scale, setScale] = React.useState(0)
  const [ready, setReady] = React.useState(false)

  const srcDoc = React.useMemo(() => withSceneController(html), [html])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / 1920)
    })
    observer.observe(container)
    setScale(container.clientWidth / 1920)

    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data
      if (!data || data.source !== SCENE_MESSAGE_TARGET) return
      if (data.type === "ready") {
        setReady(true)
        onReady?.(data.durationSec)
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [onReady])

  // Posted on every seek change, and once more on ready so a seek requested
  // before load isn't dropped.
  React.useEffect(() => {
    if (!ready || seekMs === null) return
    const message: SceneMessage = {
      target: SCENE_MESSAGE_TARGET,
      type: "seek",
      ms: seekMs,
    }
    frameRef.current?.contentWindow?.postMessage(message, "*")
  }, [ready, seekMs])

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl",
        BACKDROP_CLASS[backdrop],
        className
      )}
    >
      {/*
       * `zoom` rather than `transform: scale()`. Both fit a 1920x1080 document
       * into the card, but a scaled iframe is composited at its pre-transform
       * size — several 1920x1080 layers at once is enough to stall the
       * compositor. `zoom` rasterizes at the displayed size instead.
       */}
      <iframe
        ref={frameRef}
        title={title}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        width={1920}
        height={1080}
        scrolling="no"
        className="absolute top-0 left-0 border-0"
        style={{
          zoom: scale,
          visibility: scale > 0 ? "visible" : "hidden",
          backgroundColor: "transparent",
        }}
      />
    </div>
  )
}
