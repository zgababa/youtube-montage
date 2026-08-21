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
  /** The editing-plan element that owns this B-roll renderer job. */
  planElementId: z.string().optional(),
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
/* Structural analysis and the editing plan (ADR 0005 — issue #8)             */
/* -------------------------------------------------------------------------- */

export const PlanElementTypeSchema = z.enum(["title", "zoom", "scene"])
export const PlanElementSourceSchema = z.enum([
  "automatic",
  "manual",
  "command",
])
export const PlanElementStatusSchema = z.enum([
  "proposed",
  "approved",
  "rejected",
  "conflict",
  "orphaned",
])
export const PlanSectionSourceSchema = z.enum(["automatic", "manual"])
export const ZoomPresetSchema = z.enum(["subtle", "medium", "strong"])

/** A section is anchored to the approved script, never to model-made seconds. */
export const EditingSectionSchema = z.object({
  id: z.string(),
  fromSegment: z.number().int(),
  toSegment: z.number().int(),
  name: z.string(),
  reason: z.string(),
  source: PlanSectionSourceSchema,
})

/**
 * One visual intention in the reviewed plan.
 *
 * Type-specific fields stay optional for now so the structural analysis can
 * introduce all three catalogue members without duplicating the plan shape.
 * Later renderers validate the fields belonging to their own type.
 */
export const EditingPlanElementSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  type: PlanElementTypeSchema,
  source: PlanElementSourceSchema,
  status: PlanElementStatusSchema,
  fromSegment: z.number().int(),
  toSegment: z.number().int(),
  reason: z.string(),
  /** Model confidence is explanatory metadata, never a render permission. */
  confidence: z.number().min(0).max(1).optional(),
  titleText: z.string().optional(),
  zoomPreset: ZoomPresetSchema.optional(),
  zoomDurationSec: z.number().positive().optional(),
  coversLine: z.string().optional(),
  intent: z.string().optional(),
  sceneType: SceneTypeSchema.optional(),
  /** Project-relative title template, once the approved title was rendered. */
  htmlPath: z.string().nullable().optional(),
  /** Project-relative title movie, once the approved title was rendered. */
  exportPath: z.string().nullable().optional(),
  /** True only while this title is referenced by the composed FCPXML. */
  composed: z.boolean().optional(),
  /** Sequence offset at the last deterministic composite pass. */
  timelineOffsetSec: z.number().nonnegative().nullable().optional(),
  /** The inserted title duration on the output frame grid. */
  timelineDurationSec: z.number().positive().optional(),
})

/** The persisted plan: simple current state, not an event log. */
export const EditingDocumentSchema = z.object({
  sections: z.array(EditingSectionSchema),
  elements: z.array(EditingPlanElementSchema),
  analysisAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
})

/* -------------------------------------------------------------------------- */
/* Manual TITRE annotations (ADR 0004, ADR 0005 — issue #7)                    */
/* -------------------------------------------------------------------------- */

export const TitleAnnotationStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
])

/**
 * A manual `TITRE` annotation: an explicit editing intention, anchored to a
 * `Segment` of the approved script (`src/mastra/lib/segments.ts`) rather than
 * to the transcript's own text — adding one never rewrites a word.
 *
 * `segmentIndex` is the anchor's identity; `scriptStart`/`scriptEnd`/
 * `sourceFile` are copied from that segment at creation time so placement
 * (`titleToOverlayScene`) never has to recompute segments from the
 * transcript. Deliberately not anchored to a "section" — sections are a
 * later-issue concept (the structural analysis, ADR 0005) that doesn't exist
 * yet; a Segment is the finest-grained unit of the approved script this
 * issue can anchor to today.
 */
export const TitleAnnotationSchema = z.object({
  id: z.string(),
  segmentIndex: z.number(),
  scriptStart: z.number(),
  scriptEnd: z.number(),
  sourceFile: z.string(),
  /** The chosen copy — editable right up until it's rendered. */
  text: z.string(),
  status: TitleAnnotationStatusSchema,
  createdAt: z.string(),
  /** Project-relative, once the deterministic template has been written. */
  htmlPath: z.string().nullable(),
  /** Project-relative, once rendered to ProRes — see `steps/titles.ts`. */
  exportPath: z.string().nullable(),
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
  /** Longest silence the exported timeline keeps between two kept segments — see `timeline.ts`. */
  maxSilenceSec: z.number().positive().default(0.3),
  /** Nullable *and* defaulted: a project.json from before this field existed has neither. */
  timelineApprovedAt: z.string().nullable().default(null),
  /** Same reasoning as `timelineApprovedAt`, for the composite gate (`overlay.ts`). */
  compositeApprovedAt: z.string().nullable().default(null),
  styleGuide: StyleGuideSchema,
  scenes: z.array(SceneSchema),
  /** Structural plan; defaulted so older project.json files stay readable. */
  editingDocument: EditingDocumentSchema.default({
    sections: [],
    elements: [],
    analysisAt: null,
    reviewedAt: null,
  }),
  /** Manual TITRE annotations (issue #7). Defaulted: absent on older files. */
  titleAnnotations: z.array(TitleAnnotationSchema).default([]),
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
export type PlanElementType = z.infer<typeof PlanElementTypeSchema>
export type PlanElementSource = z.infer<typeof PlanElementSourceSchema>
export type PlanElementStatus = z.infer<typeof PlanElementStatusSchema>
export type EditingSection = z.infer<typeof EditingSectionSchema>
export type EditingPlanElement = z.infer<typeof EditingPlanElementSchema>
export type EditingDocument = z.infer<typeof EditingDocumentSchema>
export type TitleAnnotationStatus = z.infer<typeof TitleAnnotationStatusSchema>
export type TitleAnnotation = z.infer<typeof TitleAnnotationSchema>
export type YouTubeCopy = z.infer<typeof YouTubeCopySchema>
export type TwitterCopy = z.infer<typeof TwitterCopySchema>
export type ProjectCopy = z.infer<typeof ProjectCopySchema>
export type StoredProject = z.infer<typeof StoredProjectSchema>
export type Project = z.infer<typeof ProjectSchema>
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>
export type ProjectsIndex = z.infer<typeof ProjectsIndexSchema>
