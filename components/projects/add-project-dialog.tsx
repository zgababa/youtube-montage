"use client"

import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  ArrowTurnUpIcon,
  Folder01Icon,
  FolderCheckIcon,
} from "@hugeicons/core-free-icons"

import { BROWSE_ROOT, browse } from "@/lib/api"
import type { DirListing } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"

/**
 * A local server can't open a native file dialog, so adding a project means
 * typing a path or walking one with the browser backed by `/api/browse`
 * (idea.md §10).
 */
export function AddProjectDialog() {
  const [open, setOpen] = React.useState(false)
  const [path, setPath] = React.useState(BROWSE_ROOT)
  const [cwd, setCwd] = React.useState(BROWSE_ROOT)
  const [listing, setListing] = React.useState<DirListing | null>(null)

  // Derived rather than tracked, so navigating folders never renders a stale
  // listing under a fresh path.
  const loading = listing?.path !== cwd

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    browse(cwd).then((result) => {
      if (!cancelled) setListing(result)
    })
    return () => {
      cancelled = true
    }
  }, [open, cwd])

  function add() {
    setOpen(false)
    toast.add({
      title: "Project added",
      description: `${path} — nothing was copied or uploaded.`,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" />
        Add project
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a project</DialogTitle>
          <DialogDescription>
            Point the tool at a folder of raw footage. Files stay where they are —
            nothing is copied and nothing uploads.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="project-path">Project folder</FieldLabel>
            <Input
              id="project-path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/Users/you/Movies/my-video"
              className="font-mono text-xs"
            />
            <FieldDescription>
              A <span className="font-mono">project.json</span> is created here if
              one doesn&apos;t exist yet.
            </FieldDescription>
          </Field>
        </FieldGroup>

        <Separator />

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Parent folder"
              disabled={!listing?.parent}
              onClick={() => listing?.parent && setCwd(listing.parent)}
            >
              <HugeiconsIcon icon={ArrowTurnUpIcon} strokeWidth={2} />
            </Button>
            <span className="truncate font-mono text-xs text-muted-foreground">
              {cwd}
            </span>
          </div>

          <ScrollArea className="h-56 rounded-xl border">
            {loading ? (
              <div className="flex flex-col gap-2 p-2">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            ) : listing && listing.entries.length > 0 ? (
              <ItemGroup className="gap-0 p-1">
                {listing.entries.map((entry) => (
                  <Item
                    key={entry.path}
                    size="sm"
                    render={<button type="button" />}
                    className="text-left hover:bg-muted"
                    onClick={() => {
                      setPath(entry.path)
                      setCwd(entry.path)
                    }}
                  >
                    <ItemMedia variant="icon">
                      <HugeiconsIcon
                        icon={entry.hasProjectJson ? FolderCheckIcon : Folder01Icon}
                        strokeWidth={1.8}
                      />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{entry.name}</ItemTitle>
                    </ItemContent>
                    {entry.hasProjectJson ? (
                      <Badge variant="secondary">project.json</Badge>
                    ) : null}
                  </Item>
                ))}
              </ItemGroup>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">
                No subfolders here. The current path is still selectable.
              </p>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={add} disabled={path.trim().length === 0}>
            Add project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
