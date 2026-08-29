import { notFound } from "next/navigation"

import { getProject } from "@/lib/api"
import { ProjectWorkspace } from "@/components/project/project-workspace"

/**
 * The project read from disk is the baseline; a live action streams updates on
 * top of it. That ordering is the point of the storage split (idea.md §9) —
 * this page renders everything the pipeline has ever produced whether or not
 * an action is currently in flight.
 *
 * No suspended run to reconnect to any more: every action is a direct,
 * one-shot call, not a workflow parked at a gate on the server.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const project = await getProject(id)

  if (!project) notFound()

  return <ProjectWorkspace project={project} />
}
