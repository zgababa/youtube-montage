/**
 * Editing the settings a run reads but doesn't produce.
 *
 * Three things on a project are the user's to decide rather than an agent's:
 * which media files are transcription sources and how they're synced, the
 * export frame rate, and the style guide. All three are read by steps at run
 * time, so all three have to reach `project.json` before the run starts —
 * holding them in React state means they're gone on refresh and were never
 * really applied.
 */

import { z } from "zod"

import { reconcileRenderedFields } from "@/src/mastra/lib/editing-plan"
import { checkMediaRoles } from "@/src/mastra/lib/media"
import { updateProject } from "@/src/mastra/lib/project"
import { findById, removeFromIndex } from "@/src/mastra/lib/projects-index"
import { checkTranscriptionHints } from "@/src/mastra/lib/stt"
import {
  EditingDocumentSchema,
  MediaFileSchema,
  StyleGuideSchema,
  TranscriptionHintsSchema,
} from "@/src/mastra/schemas"
import { getProject } from "@/lib/api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Deliberately a whitelist, not a partial of the whole project.
 *
 * `transcript`, `spans` and `scenes` are pipeline output; letting the client
 * PATCH them would put the deliverables and the run that produced them out of
 * step with no way to tell which was right.
 */
const PatchSchema = z
  .object({
    media: z.array(MediaFileSchema),
    transcriptionHints: TranscriptionHintsSchema,
    fps: z.number().int().positive(),
    styleGuide: StyleGuideSchema,
    sourceScript: z.string().nullable(),
    /**
     * A manually-added element (title, zoom or scene) is user input, not
     * pipeline output like `scenes` — its type, anchor, status and copy are
     * the client's to set. The renderer/composition fields on each element
     * are not: only the workflow steps write those, so the handler below
     * re-attaches whatever is already on disk for a given id rather than
     * trusting the client's copy — the same reasoning that keeps `scenes`
     * off this list entirely, applied field-by-field instead of to the
     * whole array. `sections` carries nothing pipeline-owned, so it's taken
     * from the client as-is.
     */
    editingDocument: EditingDocumentSchema,
  })
  .partial()

/**
 * Forgets the folder. Never deletes anything from it.
 *
 * The tool's premise is that footage stays where it is and nothing is copied
 * (idea.md §2), so "delete" here can only reasonably mean the app's own
 * bookkeeping. Removing the index entry loses nothing that isn't recoverable by
 * pointing at the folder again — `project.json` and every deliverable in
 * `scenes/` and `exports/` are still on disk.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const removed = await removeFromIndex(id)

  if (!removed) {
    return Response.json({ error: "Unknown project" }, { status: 404 })
  }

  return Response.json({ path: removed.path })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const entry = await findById(id)
  if (!entry) {
    return Response.json({ error: "Unknown project" }, { status: 404 })
  }

  const parsed = PatchSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json(
      { error: z.prettifyError(parsed.error) },
      { status: 400 }
    )
  }

  const problem = parsed.data.media
    ? checkMediaRoles(parsed.data.media)
    : parsed.data.transcriptionHints
      ? checkTranscriptionHints(parsed.data.transcriptionHints)
      : null

  if (problem) return Response.json({ error: problem }, { status: 400 })

  await updateProject(entry.path, (project) => ({
    ...project,
    ...parsed.data,
    editingDocument: parsed.data.editingDocument
      ? reconcileRenderedFields(
          parsed.data.editingDocument,
          project.editingDocument
        )
      : project.editingDocument,
  }))

  return Response.json(await getProject(id))
}
