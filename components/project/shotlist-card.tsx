"use client"

import { shotlistText } from "@/lib/project"
import type { Project } from "@/lib/types"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CopyButton } from "@/components/copy-button"
import { StageSection } from "@/components/project/stage"

/** The plain-text file that sits on the second monitor during the edit (§11). */
export function ShotlistCard({ project }: { project: Project }) {
  const text = shotlistText(project)

  return (
    <StageSection
      title="Shot list"
      description={
        <>
          Approved scenes only, written to{" "}
          <span className="font-mono">shotlist.txt</span> in the project folder.
        </>
      }
      action={<CopyButton value={text} label="Copy shot list" size="sm" />}
    >
      <ScrollArea className="max-h-56 rounded-xl bg-muted/50">
        <pre className="p-4 font-mono text-xs leading-relaxed">
          {text || "No approved scenes yet."}
        </pre>
      </ScrollArea>
    </StageSection>
  )
}
