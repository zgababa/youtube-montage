"use client"

import { timecode } from "@/lib/format"
import { buildEditingDocument } from "@/lib/project"
import type { Project } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { StageSection } from "@/components/project/stage"

/**
 * The document de montage, minimal and visible (issue #6, ADR 0006).
 *
 * Only the layers that exist yet: the approved script and the elements
 * already known — the scenes generated so far, referenced by id. No proposed
 * effect shows up here until the structural analysis lands in a later issue.
 */
export function EditingDocumentCard({ project }: { project: Project }) {
  const document = buildEditingDocument(project)

  if (document.script === null) {
    return (
      <StageSection
        title="Document de montage"
        description="S'ouvre une fois le cleanup approuvé — le script approuvé en est la première couche."
      >
        <p className="text-xs text-muted-foreground">
          Pas encore de document. Approuvez le cleanup pour le voir apparaître.
        </p>
      </StageSection>
    )
  }

  return (
    <StageSection
      title="Document de montage"
      description={`${document.script.segmentCount} segment${document.script.segmentCount === 1 ? "" : "s"} conservé${document.script.segmentCount === 1 ? "" : "s"} · ${document.entries.length} élément${document.entries.length === 1 ? "" : "s"} connu${document.entries.length === 1 ? "" : "s"}`}
    >
      <ScrollArea className="max-h-40 rounded-xl bg-muted/50">
        <p className="p-4 text-xs leading-relaxed whitespace-pre-wrap">
          {document.script.text || "Script vide."}
        </p>
      </ScrollArea>

      {document.entries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {document.entries.map((entry) => (
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
                <Badge variant="secondary">{entry.status}</Badge>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          Aucun élément connu pour l&rsquo;instant.
        </p>
      )}
    </StageSection>
  )
}
