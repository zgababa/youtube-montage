"use client"

import * as React from "react"

import {
  plural,
  SCENE_STATUS_LABELS,
  sceneStatusVariant,
  timecode,
} from "@/lib/format"
import { buildEditingDocument } from "@/lib/project"
import type { Project } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { StageSection } from "@/components/project/stage"

/**
 * The editing document, minimal and visible (issue #6, ADR 0006).
 *
 * Only the layers that exist yet: the approved script and the elements
 * already known — the scenes generated so far, referenced by id. No proposed
 * effect shows up here until the structural analysis lands in a later issue.
 */
export function EditingDocumentCard({ project }: { project: Project }) {
  // Building the document now replays the overlay placement (issue #7's
  // `composedTitleIds`), not just a string join — worth memoizing so it
  // doesn't rerun on every render this card takes part in, only when the
  // project actually changes.
  const { script, entries, titles } = React.useMemo(
    () => buildEditingDocument(project),
    [project]
  )

  return (
    <StageSection
      title="Editing document"
      description={
        script === null
          ? "Opens once the cleanup is approved — the approved script is its first layer."
          : `${plural(script.keptSpanCount, "span")} kept · ${plural(entries.length, "known element")}`
      }
    >
      {script === null ? (
        <p className="text-xs text-muted-foreground">
          No document yet. Approve the cleanup to see it appear.
        </p>
      ) : (
        <>
          <ScrollArea className="max-h-40 rounded-xl bg-muted/50">
            <p className="p-4 text-xs leading-relaxed whitespace-pre-wrap">
              {script.text || "Empty script."}
            </p>
          </ScrollArea>

          {entries.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {entries.map((entry) => (
                <li
                  key={entry.sceneId}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 text-xs"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{entry.sceneId}</span>
                    <span className="truncate text-muted-foreground">
                      {entry.reason}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground">
                      {timecode(entry.scriptStart)}
                    </span>
                    <Badge variant={sceneStatusVariant(entry.status)}>
                      {SCENE_STATUS_LABELS[entry.status]}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No known element yet.
            </p>
          )}

          {titles.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {titles.map((title) => (
                <li
                  key={title.annotationId}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 text-xs"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">TITRE</span>
                    <span className="truncate text-muted-foreground">
                      {title.text}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground">
                      {timecode(title.scriptStart)}
                    </span>
                    <Badge variant={title.status === "approved" ? "default" : "outline"}>
                      {title.status}
                    </Badge>
                    <Badge variant={title.composed ? "default" : "outline"}>
                      {title.composed ? "composed" : "not composed"}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </StageSection>
  )
}
