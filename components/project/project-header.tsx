"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon, FolderOpenIcon } from "@hugeicons/core-free-icons"

import { longTimecode, stepStatusVariant } from "@/lib/format"
import { totalMediaSeconds } from "@/lib/project"
import type { Project, Run } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const FPS_ITEMS = [
  { label: "24 fps", value: 24 },
  { label: "25 fps", value: 25 },
  { label: "30 fps", value: 30 },
  { label: "50 fps", value: 50 },
  { label: "60 fps", value: 60 },
]

interface ProjectHeaderProps {
  project: Project
  run: Run | null
  onFpsChange: (fps: number) => void
  onReveal: () => void
}

export function ProjectHeader({
  project,
  run,
  onFpsChange,
  onReveal,
}: ProjectHeaderProps) {
  const current = run?.steps.find(
    (step) => step.status === "running" || step.status === "suspended"
  )

  return (
    <header className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 w-fit"
        render={<Link href="/" />}
        nativeButton={false}
      >
        <HugeiconsIcon
          icon={ArrowLeft01Icon}
          strokeWidth={2}
          data-icon="inline-start"
        />
        All projects
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate font-mono">{project.path}</span>
            <Separator orientation="vertical" className="h-3" />
            <span>{project.media.length} media files</span>
            <Separator orientation="vertical" className="h-3" />
            <span>{longTimecode(totalMediaSeconds(project))} of footage</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {current ? (
            <Badge variant={stepStatusVariant(current.status)}>
              {current.status === "suspended"
                ? `Waiting: ${current.label}`
                : current.label}
            </Badge>
          ) : null}

          <Select
            items={FPS_ITEMS}
            value={project.fps}
            onValueChange={(value) => onFpsChange(value as number)}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {FPS_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Reveal in Finder"
                  onClick={onReveal}
                >
                  <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
                </Button>
              }
            />
            <TooltipContent>Reveal in Finder</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  )
}
