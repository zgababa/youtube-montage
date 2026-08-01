import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Folder01Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default function ProjectNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl px-6 py-20">
      <Empty className="w-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Folder01Icon} strokeWidth={1.8} />
          </EmptyMedia>
          <EmptyTitle>Project not found</EmptyTitle>
          <EmptyDescription>
            The index in{" "}
            <span className="font-mono">~/.videotool/projects.json</span> is
            disposable — entries are dropped when their folder no longer exists.
            Add the folder again to rebuild it.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link href="/" />} nativeButton={false}>
            All projects
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}
