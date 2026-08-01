"use client"

import * as React from "react"

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // `storage` only fires for other tabs; `notify` covers this one.
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

/**
 * A string preference backed by localStorage.
 *
 * Read through `useSyncExternalStore` rather than an effect: the server has no
 * localStorage, so the server snapshot is the fallback and the client snapshot
 * is whatever was stored. React reconciles the two after hydration on its own,
 * which an effect-plus-setState version can't do without a mismatched paint.
 *
 * `isValid` guards against stale or hand-edited values and must be stable —
 * define it at module scope, not inline.
 */
export function useStoredState<T extends string>(
  key: string,
  fallback: T,
  isValid: (value: string) => value is T
): [T, (next: T) => void] {
  const getSnapshot = React.useCallback(() => {
    const stored = window.localStorage.getItem(key)
    return stored !== null && isValid(stored) ? stored : fallback
  }, [key, fallback, isValid])

  const getServerSnapshot = React.useCallback(() => fallback, [fallback])

  const value = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  )

  const setValue = React.useCallback(
    (next: T) => {
      window.localStorage.setItem(key, next)
      notify()
    },
    [key]
  )

  return [value, setValue]
}
