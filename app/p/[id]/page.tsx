import { notFound } from "next/navigation"

import { getProjectWithActiveRun } from "@/lib/api"
import { ProjectWorkspace } from "@/components/project/project-workspace"

/**
 * The project read from disk is the baseline; a live run streams updates on top
 * of it. That ordering is the point of the storage split (idea.md §9) — this
 * page renders everything the pipeline has ever produced whether or not a run
 * is currently connected.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // A suspended run is correlated by project path (idea.md §9, issue #3), so
  // the lookup only needs the index entry — it runs alongside `project.json`'s
  // own read rather than waiting behind it (see `getProjectWithActiveRun`).
  const { project, activeRunId } = await getProjectWithActiveRun(id)

  if (!project) notFound()

  return <ProjectWorkspace project={project} activeRunId={activeRunId} />
}
