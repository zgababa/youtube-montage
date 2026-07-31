import { notFound } from "next/navigation"

import { getLatestRun, getProject } from "@/lib/api"
import { ProjectWorkspace } from "@/components/project/project-workspace"

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const project = await getProject(id)

  if (!project) notFound()

  const run = await getLatestRun(id)

  return <ProjectWorkspace project={project} run={run} />
}
