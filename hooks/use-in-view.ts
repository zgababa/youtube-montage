"use client"

import * as React from "react"

/**
 * Tracks whether an element is near the viewport.
 *
 * Scene previews are full 1920x1080 iframes running real CSS animations. A
 * dozen of them mounted at once is enough compositor work to make the page
 * stutter, so the scene list only keeps the visible ones alive.
 */
export function useInView<T extends HTMLElement>(rootMargin = "400px") {
  const ref = React.useRef<T>(null)
  const [inView, setInView] = React.useState(false)

  React.useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin }
    )
    observer.observe(element)

    return () => observer.disconnect()
  }, [rootMargin])

  return { ref, inView }
}
