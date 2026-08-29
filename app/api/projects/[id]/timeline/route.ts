/**
 * Writes the cut timeline and recomposites it in one request.
 *
 * ADR 0009: `writeTimeline`/`writeComposite` are deterministic and cheap —
 * no LLM call, no rendering — so there's nothing to gain from running them
 * only as steps of a suspended workflow the client has to be lined up with.
 * This is the same work `timelineStep`/`overlayStep` do mid-run, called
 * directly instead, available any time regardless of whether a pipeline run
 * is active or where it's currently suspended.
 */

import { z } from "zod"

import { readStoredProject, updateProject } from "@/src/mastra/lib/project"
import { findById } from "@/src/mastra/lib/projects-index"
import { writeComposite } from "@/src/mastra/steps/overlay"
import { writeTimeline } from "@/src/mastra/steps/timeline"
import { getProject } from "@/lib/api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BodySchema = z
  .object({ maxSilenceSec: z.number().positive() })
  .partial()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const entry = await findById(id)
  if (!entry) {
    return Response.json({ error: "Unknown project" }, { status: 404 })
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return Response.json(
      { error: z.prettifyError(parsed.error) },
      { status: 400 }
    )
  }

  const project = await readStoredProject(entry.path)
  if (!project.cleanupApprovedAt) {
    return Response.json(
      { error: "Approve cleanup before exporting the timeline." },
      { status: 400 }
    )
  }

  const maxSilenceSec = parsed.data.maxSilenceSec ?? project.maxSilenceSec
  await writeTimeline(project, maxSilenceSec)
  await updateProject(entry.path, (current) => ({
    ...current,
    maxSilenceSec,
    timelineApprovedAt: new Date().toISOString(),
  }))

  // Recomposite against what was just written, not the copy read before it —
  // `writeComposite` reads `runs`/`overlays` off `project`, and those depend
  // on `maxSilenceSec`.
  const refreshed = await readStoredProject(entry.path)
  await writeComposite(refreshed)
  await updateProject(entry.path, (current) => ({
    ...current,
    compositeApprovedAt: new Date().toISOString(),
  }))

  return Response.json(await getProject(id))
}
