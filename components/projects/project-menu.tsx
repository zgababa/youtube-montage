"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Delete02Icon,
  FolderOpenIcon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons"

import { addProject, removeProject, reveal } from "@/lib/client-api"
import type { ProjectSummary } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"

/**
 * Per-project actions, for a card or a row.
 *
 * Both are wrapped in a `<Link>` to the project, so every interaction here has
 * to stop propagation — otherwise opening the menu navigates away from the
 * thing you were about to act on.
 */
export function ProjectMenu({ project }: { project: ProjectSummary }) {
  const router = useRouter()

  function remove() {
    removeProject(project.id)
      .then(({ path }) => {
        router.refresh()
        toast.add({
          title: "Removed from the list",
          // Said plainly, because "delete" in every other app means the files
          // are gone. Here nothing on disk was touched.
          description: `${path} — the folder and everything in it is untouched.`,
          actionProps: {
            children: "Undo",
            onClick: () => {
              addProject(path)
                .then(() => router.refresh())
                .catch((error: Error) =>
                  toast.add({
                    title: "Couldn't undo",
                    description: error.message,
                  })
                )
            },
          },
        })
      })
      .catch((error: Error) =>
        toast.add({ title: "Couldn't remove", description: error.message })
      )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${project.name}`}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
          </Button>
        }
      />

      <DropdownMenuContent
        align="end"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem
          onClick={() => {
            reveal(project.path).catch((error: Error) =>
              toast.add({
                title: "Couldn't reveal",
                description: error.message,
              })
            )
          }}
        >
          <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
          Reveal in Finder
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onClick={remove}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          Remove from list
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
