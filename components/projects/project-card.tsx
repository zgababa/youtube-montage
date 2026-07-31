import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { relativeDate } from "@/lib/format"
import type { ProjectSummary } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="truncate">
          <Link href={`/p/${project.id}`} className="hover:underline">
            <Highlight text={project.name} query={query} />
          </Link>
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs">
          <Highlight text={project.path} query={query} />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProjectThumbnail html={project.thumbnailHtml} />
      </CardContent>
      <CardFooter className="flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{project.sceneCount} scenes</Badge>
          <Badge variant={project.exportedCount > 0 ? "default" : "outline"}>
            {project.exportedCount} exported
          </Badge>
          <span className="text-xs text-muted-foreground">
            opened {relativeDate(project.lastOpened)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/p/${project.id}`} />}
          nativeButton={false}
        >
          Open
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            data-icon="inline-end"
          />
        </Button>
      </CardFooter>
    </Card>
  )
}
