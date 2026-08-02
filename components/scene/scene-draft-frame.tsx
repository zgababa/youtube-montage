"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  SCENE_DRAFT_SHELL,
  SCENE_MESSAGE_TARGET,
  type SceneMessage,
} from "@/lib/scene-controller"
import type { SceneBackdrop } from "@/components/scene/scene-frame"

const BACKDROP_CLASS: Record<SceneBackdrop, string> = {
  checker: "scene-backdrop-checker",
  dark: "scene-backdrop-dark",
  light: "scene-backdrop-light",
}

interface SceneDraftFrameProps {
  /** The document so far. Only ever grows, for one attempt. */
  html: string
  backdrop?: SceneBackdrop
  className?: string
  title: string
}

/**
 * A scene while it is still being written.
 *
 * The counterpart to `SceneFrame`, and deliberately not the same component. A
 * finished scene is a document you hand to the frame; a draft is a document
 * arriving in pieces, and the difference is the whole design: `srcDoc` reloads
 * the frame on every assignment, so a draft rendered that way would restart its
 * own animations several times a second. Here the frame loads once and each new
 * piece is written into the document that is already open — the browser's own
 * incremental parse, which is what makes half a document look like half a
 * scene instead of like markup.
 *
 * Nothing is scrubbable and nothing reports a duration. Both belong to the
 * finished scene, which replaces this the moment it validates.
 */
export function SceneDraftFrame({
  html,
  backdrop = "checker",
  className,
  title,
}: SceneDraftFrameProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const frameRef = React.useRef<HTMLIFrameElement>(null)
  const [scale, setScale] = React.useState(0)
  const [ready, setReady] = React.useState(false)
  /** How much of `html` the frame has been given. Never rewound. */
  const written = React.useRef(0)

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
      if (data.type === "draft-ready") setReady(true)
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  // Everything the shell hasn't been given yet, which on the first pass after
  // it loads is everything that arrived while it was loading.
  React.useEffect(() => {
    if (!ready || html.length <= written.current) return

    const message: SceneMessage = {
      target: SCENE_MESSAGE_TARGET,
      type: "draft",
      chunk: html.slice(written.current),
    }
    written.current = html.length
    frameRef.current?.contentWindow?.postMessage(message, "*")
  }, [ready, html])

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl",
        BACKDROP_CLASS[backdrop],
        className
      )}
    >
      {/* `zoom` for the same reason as `SceneFrame` — a scaled 1920x1080 layer
          is composited at its pre-transform size. */}
      <iframe
        ref={frameRef}
        title={title}
        sandbox="allow-scripts"
        srcDoc={SCENE_DRAFT_SHELL}
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
