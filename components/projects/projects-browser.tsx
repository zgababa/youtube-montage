"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Folder01Icon,
  Grid02Icon,
  LeftToRightListBulletIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"

import type { ProjectSummary } from "@/lib/types"
import { useStoredState } from "@/hooks/use-stored-state"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ItemGroup } from "@/components/ui/item"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SearchInput } from "@/components/search-input"
import { AddProjectDialog } from "@/components/projects/add-project-dialog"
import { ProjectCard } from "@/components/projects/project-card"
import { ProjectRow } from "@/components/projects/project-row"

type ProjectView = "list" | "cards"

const VIEW_STORAGE_KEY = "videotool:projects-view"

function isProjectView(value: string): value is ProjectView {
  return value === "list" || value === "cards"
}

export function ProjectsBrowser({ projects }: { projects: ProjectSummary[] }) {
  const [query, setQuery] = React.useState("")
  const [view, setView] = useStoredState<ProjectView>(
    VIEW_STORAGE_KEY,
    "list",
    isProjectView
  )

  const matches = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return projects
    return projects.filter((project) =>
      `${project.name} ${project.path}`.toLowerCase().includes(needle)
    )
  }, [projects, query])

  if (projects.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Folder01Icon} strokeWidth={1.8} />
          </EmptyMedia>
          <EmptyTitle>No projects yet</EmptyTitle>
          <EmptyDescription>
            Add a folder of raw footage to get started.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <AddProjectDialog />
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="max-w-sm"
          label="Search projects"
          placeholder="Search by name or folder…"
          value={query}
          onValueChange={setQuery}
        />
        {query ? (
          <span className="text-xs text-muted-foreground">
            {matches.length} of {projects.length} projects
          </span>
        ) : null}

        <ToggleGroup
          className="ml-auto"
          size="sm"
          value={[view]}
          onValueChange={(value) => {
            const next = value[0] as ProjectView | undefined
            if (next) setView(next)
          }}
        >
          <Tooltip>
            <TooltipTrigger
              render={<ToggleGroupItem value="list" aria-label="List view" />}
            >
              <HugeiconsIcon
                icon={LeftToRightListBulletIcon}
                strokeWidth={2}
              />
            </TooltipTrigger>
            <TooltipContent>List view</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={<ToggleGroupItem value="cards" aria-label="Card view" />}
            >
              <HugeiconsIcon icon={Grid02Icon} strokeWidth={2} />
            </TooltipTrigger>
            <TooltipContent>Card view</TooltipContent>
          </Tooltip>
        </ToggleGroup>
      </div>

      {matches.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Search01Icon} strokeWidth={1.8} />
            </EmptyMedia>
            <EmptyTitle>No projects match “{query}”</EmptyTitle>
            <EmptyDescription>
              Search covers the project name and its folder path.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </EmptyContent>
        </Empty>
      ) : view === "list" ? (
        <ItemGroup className="gap-2">
          {matches.map((project) => (
            <ProjectRow key={project.id} project={project} query={query} />
          ))}
        </ItemGroup>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {matches.map((project) => (
            <ProjectCard key={project.id} project={project} query={query} />
          ))}
        </div>
      )}
    </div>
  )
}
