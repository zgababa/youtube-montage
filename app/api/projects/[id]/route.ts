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
import { findById, removeFromIndex } from "@/src/mastra/lib/projects-index"
import {
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
  })
  .partial()

/** AssemblyAI's documented ceiling, counted the way they count it. */
const MAX_KEYTERM_WORDS = 1000
const MAX_WORDS_PER_PHRASE = 6

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
    ? checkMedia(parsed.data.media)
    : parsed.data.transcriptionHints
      ? checkHints(parsed.data.transcriptionHints)
      : null

  if (problem) return Response.json({ error: problem }, { status: 400 })

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
/**
 * Refused here rather than at the provider.
 *
 * An over-long keyterm list doesn't fail loudly at AssemblyAI — capacity is
 * documented as approximate and terms past the limit simply stop having an
 * effect. Saying so at save time is the only place the user finds out.
 */
function checkHints(
  hints: z.infer<typeof TranscriptionHintsSchema>
): string | null {
  const tooLong = hints.keyterms.find(
    (term) => term.trim().split(/\s+/).length > MAX_WORDS_PER_PHRASE
  )
  if (tooLong) {
    return `"${tooLong}" is longer than ${MAX_WORDS_PER_PHRASE} words. Keyterms are names and phrases, not sentences — put the context in the description instead.`
  }

  const words = hints.keyterms.reduce(
    (total, term) => total + term.trim().split(/\s+/).length,
    0
  )
  if (words > MAX_KEYTERM_WORDS) {
    return `${words} words across the keyterms, over the ${MAX_KEYTERM_WORDS} limit. Terms past it stop having any effect.`
  }

  return null
}

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
