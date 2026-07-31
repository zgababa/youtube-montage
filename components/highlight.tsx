import * as React from "react"

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Marks every case-insensitive occurrence of `query` inside `text`.
 *
 * The text itself is never altered — this only wraps matches, which matters in
 * the cleanup diff where what's on screen has to stay verbatim transcript.
 */
export function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim()

  const parts = React.useMemo(() => {
    if (!needle) return null
    return text.split(new RegExp(`(${escapeRegExp(needle)})`, "gi"))
  }, [text, needle])

  if (!parts) return <>{text}</>

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === needle.toLowerCase() ? (
          <mark
            key={index}
            className="rounded-sm bg-primary/25 px-0.5 text-foreground"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        )
      )}
    </>
  )
}
