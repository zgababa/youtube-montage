import Link from "next/link"

import { relativeDate } from "@/lib/format"
import type { ProjectSummary } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Highlight } from "@/components/highlight"
import { ProjectMenu } from "@/components/projects/project-menu"
import { ProjectThumbnail } from "@/components/projects/project-thumbnail"

export function ProjectRow({
  project,
  query = "",
}: {
  project: ProjectSummary
  /** Active projects search, highlighted in the name and path. */
  query?: string
}) {
  return (
    <Item
      variant="outline"
      size="sm"
      render={<Link href={`/p/${project.id}`} />}
      className="hover:bg-muted/50"
    >
      {/* Narrow enough to scan down a column of them without the row growing. */}
      <ItemMedia className="w-32 self-center">
        <ProjectThumbnail html={project.thumbnailHtml} />
      </ItemMedia>

      <ItemContent>
        <ItemTitle className="text-base">
          <Highlight text={project.name} query={query} />
        </ItemTitle>
        <ItemDescription className="font-mono text-xs">
          <Highlight text={project.path} query={query} />
        </ItemDescription>
      </ItemContent>

      <ItemContent className="hidden items-end gap-1.5 sm:flex">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{project.sceneCount} scenes</Badge>
          <Badge variant={project.exportedCount > 0 ? "default" : "outline"}>
            {project.exportedCount} exported
          </Badge>
        </div>
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          opened {relativeDate(project.lastOpened)}
        </span>
      </ItemContent>

      <ProjectMenu project={project} />
    </Item>
  )
}
