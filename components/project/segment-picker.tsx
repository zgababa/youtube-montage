"use client"

import * as React from "react"

/**
 * Picks a range of kept segments with two clicks — an anchor, then an end —
 * rather than native text selection. Nothing in this app maps a browser
 * `Selection` back to a segment index, and a solo creator picking where a
 * title/zoom/scene starts and ends doesn't need more than "click the first
 * word, click the last word."
 */
export function useSegmentPicker() {
  const [anchor, setAnchor] = React.useState<number | null>(null)
  const [hover, setHover] = React.useState<number | null>(null)
  const [range, setRange] = React.useState<{ from: number; to: number } | null>(
    null
  )

  const onSegmentClick = React.useCallback(
    (index: number) => {
      if (anchor === null) {
        setAnchor(index)
        return
      }
      setRange({ from: Math.min(anchor, index), to: Math.max(anchor, index) })
      setAnchor(null)
      setHover(null)
    },
    [anchor]
  )

  const onSegmentHover = React.useCallback((index: number) => {
    setHover(index)
  }, [])

  const cancel = React.useCallback(() => {
    setAnchor(null)
    setHover(null)
  }, [])

  const clearRange = React.useCallback(() => setRange(null), [])

  /** Segments highlighted while the second click hasn't landed yet. */
  const pending =
    anchor !== null && hover !== null
      ? { from: Math.min(anchor, hover), to: Math.max(anchor, hover) }
      : anchor !== null
        ? { from: anchor, to: anchor }
        : null

  return {
    picking: anchor !== null,
    pending,
    range,
    onSegmentClick,
    onSegmentHover,
    cancel,
    clearRange,
  }
}

export type SegmentPicker = ReturnType<typeof useSegmentPicker>
