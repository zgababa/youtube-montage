"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Film01Icon } from "@hugeicons/core-free-icons"

import { useInView } from "@/hooks/use-in-view"
import { Skeleton } from "@/components/ui/skeleton"
import { SceneFrame } from "@/components/scene/scene-frame"

/**
 * The card thumbnail: the project's first scene, frozen at its midpoint —
 * the same frame the Playwright screenshot would grab (idea.md §10).
 */
export function ProjectThumbnail({ html }: { html: string | null }) {
  // Null until the scene reports a real duration — seeking to 0 before the
  // animations exist would freeze the card on an empty first frame.
  const [seekMs, setSeekMs] = React.useState<number | null>(null)
  const { ref, inView } = useInView<HTMLDivElement>("200px")

  const onReady = React.useCallback((durationSec: number) => {
    if (durationSec > 0) setSeekMs((durationSec * 1000) / 2)
  }, [])

  if (!html) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <HugeiconsIcon icon={Film01Icon} strokeWidth={1.5} className="size-8" />
      </div>
    )
  }

  return (
    <div ref={ref}>
      {inView ? (
        <SceneFrame
          html={html}
          seekMs={seekMs}
          backdrop="dark"
          onReady={onReady}
          title="Project thumbnail"
        />
      ) : (
        <Skeleton className="aspect-video w-full rounded-xl" />
      )}
    </div>
  )
}
