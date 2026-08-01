import { listProjects } from "@/lib/api"
import { AddProjectDialog } from "@/components/projects/add-project-dialog"
import { ProjectsBrowser } from "@/components/projects/projects-browser"

export default async function ProjectsPage() {
  const projects = await listProjects()

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Projects
          </h1>
          <p className="text-sm text-muted-foreground">
            Runs on localhost. Footage never leaves the folder it&apos;s in.
          </p>
        </div>
        <AddProjectDialog />
      </header>

      <ProjectsBrowser projects={projects} />
    </main>
  )
}
