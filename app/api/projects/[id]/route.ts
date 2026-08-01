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

import { updateProject } from "@/src/mastra/lib/project"
import { findById } from "@/src/mastra/lib/projects-index"
import { MediaFileSchema, StyleGuideSchema } from "@/src/mastra/schemas"
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
    fps: z.number().int().positive(),
    styleGuide: StyleGuideSchema,
  })
  .partial()

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

  if (parsed.data.media) {
    const problem = checkMedia(parsed.data.media)
    if (problem) return Response.json({ error: problem }, { status: 400 })
  }

  await updateProject(entry.path, (project) => ({ ...project, ...parsed.data }))

  return Response.json(await getProject(id))
}

/**
 * Catches the two ways the media settings can be internally inconsistent.
 *
 * Both are worth refusing rather than storing: a `voices` pointing nowhere
 * silently retags words onto a file the editor doesn't have, and a chain of
 * them has no well-defined anchor at all.
 */
function checkMedia(media: z.infer<typeof MediaFileSchema>[]): string | null {
  const paths = new Set(media.map((file) => file.path))

  for (const file of media) {
    if (file.voices === null) continue

    if (!paths.has(file.voices)) {
      return `${file.path} is set to voice ${file.voices}, which isn't in this project.`
    }
    if (file.voices === file.path) {
      return `${file.path} can't voice itself.`
    }

    const target = media.find((other) => other.path === file.voices)
    if (target?.voices) {
      return `${file.path} voices ${file.voices}, which voices something else in turn. Point it at the clip you actually scrub.`
    }
  }

  return null
}
