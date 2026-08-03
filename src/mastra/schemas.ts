/**
 * `project.json`, as Zod (idea.md §7).
 *
 * These schemas do three jobs at once, which is why they live here rather than
 * being written out three times:
 *
 *   1. workflow step `inputSchema` / `outputSchema`
 *   2. validation when reading a `project.json` off disk — projects are
 *      portable, so the file on disk may have been written by an older build
 *   3. the UI's TypeScript types, via `z.infer` re-exported from `lib/types.ts`
 *
 * Nothing here imports from `next`. The workflow has to run headless from
 * Studio and from a plain script (idea.md §8), so this file and everything
 * under `src/mastra/` stays framework-free.
 */

import { z } from "zod"

/* -------------------------------------------------------------------------- */
/* Span decisions — the load-bearing part (idea.md §3)                         */
/* -------------------------------------------------------------------------- */

export const SpanActionSchema = z.enum(["keep", "cut"])

export const SpanCategorySchema = z.enum([
  "filler",
  "redundant",
  "bad_take",
  "tangent",
  "false_start",
])

export const SpanSchema = z.object({
  start: z.number(),
  end: z.number(),
  action: SpanActionSchema,
  reason: z.string().optional(),
  category: SpanCategorySchema.optional(),
})

/** One transcribed word. `start`/`end` are absolute seconds within `file`. */
export const WordSchema = z.object({
  w: z.string(),
  start: z.number(),
  end: z.number(),
  file: z.string(),
})

/* -------------------------------------------------------------------------- */
/* Media and scenes                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One file in the project folder.
 *
 * The last three fields exist because the same performance is routinely
 * captured twice: a camera recording its own scratch audio, and a separate mic
 * recording the good audio. Without them, `scan` finds both, `transcribe`
 * transcribes both, and the script contains the whole talk twice — with half
 * the resulting scenes carrying timecodes on one clock and half on the other.
 *
 * All three default, so a `project.json` written before they existed still
 * parses and behaves the way it used to.
 */
export const MediaFileSchema = z.object({
  path: z.string(),
  durationSec: z.number(),
  hasAudio: z.boolean(),
  /** False for a standalone audio file — how a separate mic track is spotted. */
  hasVideo: z.boolean().default(true),
  /** Whether this file's audio is sent to the transcriber. */
  transcribe: z.boolean().default(true),
  /**
   * Seconds added to every word from this file to land it on the anchor clock.
   *
   * A mic started 8.2s before the camera reads -8.2: its own 10.0s mark is the
   * camera's 1.8s. Zero for a file that is its own anchor.
   */
  offsetSec: z.number().default(0),
  /**
   * The clip this file is the audio for, as a project-relative path.
   *
   * Set, and words from this file are tagged with *that* path — so a scene cut
   * from the good mic still tells the editor to scrub the camera clip, which is
   * the one they actually have on the timeline. Null means the file speaks for
   * itself.
   */
  voices: z.string().nullable().default(null),
})

export const SceneStatusSchema = z.enum([
  "pending",
  "generating",
  "ready",
  "approved",
  "rejected",
  "exporting",
  "exported",
  "failed",
])

/** Different types get different generation prompts and different hit rates. */
export const SceneTypeSchema = z.enum([
  "diagram",
  "code",
  "data",
  "process",
  "concept",
])

export const StyleGuideSchema = z.object({
  palette: z.array(z.string()),
  fontStack: z.string(),
  motion: z.string(),
  notes: z.string(),
})

/** A scene as stored in `project.json` — HTML lives in its own file. */
export const SceneSchema = z.object({
  id: z.string(),
  scriptStart: z.number(),
  scriptEnd: z.number(),
  windowSec: z.number(),
  coversLine: z.string(),
  sourceFile: z.string(),
  intent: z.string(),
  type: SceneTypeSchema,
  status: SceneStatusSchema,
  htmlPath: z.string().nullable(),
  exportPath: z.string().nullable(),
  measuredDurationSec: z.number().nullable(),
  /** Set when generation returned `{ html: null, failed: true }`. */
  error: z.string().optional(),
  /** Note attached to the last regenerate request. */
  note: z.string().optional(),
  /**
   * Router id of the model that wrote the current HTML.
   *
   * Written by the generate step rather than by the reviewer, so it always
   * describes what actually ran — including on a failed scene, where knowing
   * which model couldn't do it is most of the diagnosis. Absent on scenes
   * generated before the field existed.
   */
  model: z.string().optional(),
})

/**
 * A scene with its HTML read in.
 *
 * The HTML is deliberately *not* in `project.json` — it would balloon the file
 * and duplicate `scenes/scene_NN.html`. It is read server-side and passed as a
 * string, because previews are never served as files (idea.md §10).
 */
export const HydratedSceneSchema = SceneSchema.extend({
  html: z.string().nullable(),
})

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

export const YouTubeCopySchema = z.object({
  title: z.array(z.string()),
  description: z.string(),
  chapters: z.array(z.object({ timecode: z.string(), label: z.string() })),
  tags: z.array(z.string()),
})

export const TwitterCopySchema = z.object({
  hook: z.string(),
  thread: z.array(z.string()),
  standalone: z.string(),
})

export const ProjectCopySchema = z.object({
  youtube: YouTubeCopySchema,
  twitter: TwitterCopySchema,
})

/* -------------------------------------------------------------------------- */
/* Transcription hints                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What the transcriber is told about the recording before it starts.
 *
 * Everything downstream is a rewrite of the transcript — the cleanup diff, the
 * b-roll briefs, the YouTube description, the thread. A product name heard
 * wrong doesn't stay a transcription error; it propagates into every asset as
 * a confident misspelling. These two hints are the only chance to fix it at
 * the source, and they cost nothing per run.
 */
export const TranscriptionHintsSchema = z.object({
  /**
   * A sentence or two on what the recording is about — domain, product,
   * scenario. Describes the audio, not how to transcribe it: formatting and
   * behavioural instructions are ignored by the model.
   */
  prompt: z.string().default(""),
  /**
   * Exact spellings the model should prefer: libraries, product names, people.
   * Up to ~1000 words in total, 6 words per phrase.
   */
  keyterms: z.array(z.string()).default([]),
})

/* -------------------------------------------------------------------------- */
/* The file itself                                                             */
/* -------------------------------------------------------------------------- */

export const StoredProjectSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  path: z.string(),
  name: z.string(),
  createdAt: z.string(),
  fps: z.number(),
  media: z.array(MediaFileSchema),
  transcriptionHints: TranscriptionHintsSchema.default({
    prompt: "",
    keyterms: [],
  }),
  transcript: z.object({ words: z.array(WordSchema) }),
  spans: z.array(SpanSchema),
  cleanupApprovedAt: z.string().nullable(),
  styleGuide: StyleGuideSchema,
  scenes: z.array(SceneSchema),
  copy: ProjectCopySchema.nullable(),
})

/** What the UI receives: the file plus each scene's HTML. */
export const ProjectSchema = StoredProjectSchema.extend({
  scenes: z.array(HydratedSceneSchema),
})

/** Row in `~/.videotool/projects.json`, enriched with counts for the list. */
export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  createdAt: z.string(),
  lastOpened: z.string(),
  sceneCount: z.number(),
  exportedCount: z.number(),
  /** Scene HTML used as the thumbnail, frozen at its midpoint. */
  thumbnailHtml: z.string().nullable(),
})

/**
 * The projects index. Deliberately disposable — entries whose folders no longer
 * exist are dropped on read, and the whole thing is rebuildable by re-adding
 * folders (idea.md §7).
 */
export const ProjectsIndexSchema = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      lastOpened: z.string(),
    })
  ),
})

export type SpanAction = z.infer<typeof SpanActionSchema>
export type SpanCategory = z.infer<typeof SpanCategorySchema>
export type Span = z.infer<typeof SpanSchema>
export type Word = z.infer<typeof WordSchema>
export type MediaFile = z.infer<typeof MediaFileSchema>
export type TranscriptionHints = z.infer<typeof TranscriptionHintsSchema>
export type SceneStatus = z.infer<typeof SceneStatusSchema>
export type SceneType = z.infer<typeof SceneTypeSchema>
export type StyleGuide = z.infer<typeof StyleGuideSchema>
export type StoredScene = z.infer<typeof SceneSchema>
export type Scene = z.infer<typeof HydratedSceneSchema>
export type YouTubeCopy = z.infer<typeof YouTubeCopySchema>
export type TwitterCopy = z.infer<typeof TwitterCopySchema>
export type ProjectCopy = z.infer<typeof ProjectCopySchema>
export type StoredProject = z.infer<typeof StoredProjectSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>
export type ProjectsIndex = z.infer<typeof ProjectsIndexSchema>
