"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Folder01Icon, Search01Icon } from "@hugeicons/core-free-icons"

import type { ProjectSummary } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { SearchInput } from "@/components/search-input"
import { AddProjectDialog } from "@/components/projects/add-project-dialog"
import { ProjectCard } from "@/components/projects/project-card"

export function ProjectsGrid({ projects }: { projects: ProjectSummary[] }) {
  const [query, setQuery] = React.useState("")

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
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {matches.map((project) => (
            <ProjectCard key={project.id} project={project} query={query} />
          ))}
        </div>
      )}
    </div>
  )
}
