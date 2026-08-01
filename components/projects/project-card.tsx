import Link from "next/link"

import { relativeDate } from "@/lib/format"
import type { ProjectSummary } from "@/lib/types"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Highlight } from "@/components/highlight"
import { ProjectThumbnail } from "@/components/projects/project-thumbnail"

export function ProjectCard({
  project,
  query = "",
}: {
  project: ProjectSummary
  /** Active projects search, highlighted in the name and path. */
  query?: string
}) {
  return (
    <Card
      size="sm"
      className="group/project relative gap-3 transition-shadow hover:shadow-lg"
    >
      {/* Inert so the stretched link below owns every click on the card. */}
      <CardContent className="pointer-events-none">
        <ProjectThumbnail html={project.thumbnailHtml} />
      </CardContent>

      <CardHeader>
        <CardTitle className="text-sm">
          <Tooltip>
            {/*
             * The trigger is the whole card: `after:inset-0` stretches its hit
             * area over the Card, so hovering anywhere reveals the folder path
             * and clicking anywhere opens the project.
             */}
            <TooltipTrigger
              render={<Link href={`/p/${project.id}`} />}
              className="block truncate after:absolute after:inset-0 group-hover/project:underline"
            >
              <Highlight text={project.name} query={query} />
            </TooltipTrigger>
            <TooltipContent className="font-mono">
              <Highlight text={project.path} query={query} />
            </TooltipContent>
          </Tooltip>
        </CardTitle>
        <CardDescription className="truncate text-xs">
          {project.sceneCount} scenes · {project.exportedCount} exported ·{" "}
          {relativeDate(project.lastOpened)}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
