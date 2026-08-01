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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Highlight } from "@/components/highlight"
import { ProjectMenu } from "@/components/projects/project-menu"
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
      {/*
       * Above the stretched link, which otherwise covers the whole card and
       * would swallow the menu's clicks. Revealed on hover so a wall of cards
       * stays quiet, but kept reachable by keyboard at all times.
       */}
      <div className="absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover/project:opacity-100 focus-within:opacity-100">
        <ProjectMenu project={project} />
      </div>

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
              className="block truncate group-hover/project:underline after:absolute after:inset-0"
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
