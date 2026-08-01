/**
 * `project.json` — read, mutate, write.
 *
 * This file is the deliverable half of the storage split (idea.md §9). Mastra's
 * database owns which step is running; this owns the transcript, the spans, the
 * scenes, and the copy. Every step writes its output through here *before*
 * returning, so a lost stream or a crashed server costs liveness and never
 * work.
 *
 * Two things make that harder than it looks:
 *
 *   - Scene generation runs at `concurrency: 3`, so three steps race to update
 *     three different scenes in one file. Read-modify-write without a lock
 *     loses two of them.
 *   - A half-written `project.json` is worse than no `project.json` — it's the
 *     source of truth. Writes go to a temp file and get renamed, which is
 *     atomic on the same filesystem.
 */

import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import {
  ProjectSchema,
  StoredProjectSchema,
  type Project,
  type StoredProject,
} from "../schemas"
import { projectFile, sceneHtmlPath, toAbsolute } from "./paths"

/* -------------------------------------------------------------------------- */
/* Serialization                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One promise chain per project path. `update()` appends to the chain rather
 * than reading immediately, so concurrent scene steps queue instead of
 * clobbering each other.
 *
 * Module-level, which is correct here: the whole point is that every writer in
 * this process shares one queue. It does *not* guard against a second process
 * (Studio, say) writing the same file — nothing short of a lock file would, and
 * driving one run from two processes is already out of bounds.
 */
const queues = new Map<string, Promise<unknown>>()

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  // Swallow the predecessor's rejection: one failed update must not poison
  // every later one queued behind it.
  const next = previous.then(task, task)
  queues.set(
    key,
    next.catch(() => {})
  )
  return next
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Reads and validates the file. Throws if it's missing or malformed. */
export async function readStoredProject(
  projectPath: string
): Promise<StoredProject> {
  const raw = await fs.readFile(projectFile(projectPath), "utf8")
  return StoredProjectSchema.parse(JSON.parse(raw))
}

/** Same, but `null` instead of throwing when the file simply isn't there. */
export async function tryReadStoredProject(
  projectPath: string
): Promise<StoredProject | null> {
  try {
    return await readStoredProject(projectPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

/**
 * Reads the project with each scene's HTML attached.
 *
 * The HTML is on disk in `scenes/`, not in `project.json` — inlining it would
 * balloon the file. The UI needs it as a string regardless, since previews are
 * never served as files (idea.md §10), so hydration happens here.
 */
export async function readProject(projectPath: string): Promise<Project> {
  const stored = await readStoredProject(projectPath)
  return hydrate(projectPath, stored)
}

export async function hydrate(
  projectPath: string,
  stored: StoredProject
): Promise<Project> {
  const scenes = await Promise.all(
    stored.scenes.map(async (scene) => ({
      ...scene,
      html: await readSceneHtml(projectPath, scene.htmlPath),
    }))
  )
  return ProjectSchema.parse({ ...stored, scenes })
}

export async function readSceneHtml(
  projectPath: string,
  htmlPath: string | null
): Promise<string | null> {
  if (!htmlPath) return null
  try {
    return await fs.readFile(toAbsolute(projectPath, htmlPath), "utf8")
  } catch {
    // A missing HTML file means the scene was never generated, or the folder
    // moved between machines. Neither is worth failing a read over.
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Read, apply `mutate`, write — with everything else touching this project
 * queued behind it.
 *
 * The mutator receives a fresh read, so it can't operate on a stale copy: by
 * the time it runs, every earlier update has already landed.
 */
export async function updateProject(
  projectPath: string,
  mutate: (project: StoredProject) => StoredProject | Promise<StoredProject>
): Promise<StoredProject> {
  return serialize(projectPath, async () => {
    const current = await readStoredProject(projectPath)
    const next = StoredProjectSchema.parse(await mutate(current))
    await writeAtomic(projectFile(projectPath), stringify(next))
    return next
  })
}

/** Creates the file. Fails rather than overwriting an existing project. */
export async function createProject(
  projectPath: string,
  project: StoredProject
): Promise<StoredProject> {
  return serialize(projectPath, async () => {
    const parsed = StoredProjectSchema.parse(project)
    const file = projectFile(projectPath)
    try {
      await fs.writeFile(file, stringify(parsed), { flag: "wx" })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`${file} already exists — open the project instead`)
      }
      throw error
    }
    return parsed
  })
}

/**
 * Writes a generated scene's HTML and points the scene at it.
 *
 * Kept here rather than in the generate step so the file write and the
 * `project.json` update can't drift: a scene with an `htmlPath` that doesn't
 * resolve renders as a blank preview with no error.
 */
export async function writeSceneHtml(
  projectPath: string,
  sceneId: string,
  html: string
): Promise<string> {
  const absolute = sceneHtmlPath(projectPath, sceneId)
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await writeAtomic(absolute, html)
  return path.relative(projectPath, absolute)
}

/**
 * Rename-into-place.
 *
 * The temp file sits in the destination directory on purpose: `rename` is only
 * atomic within a filesystem, and `os.tmpdir()` is frequently a different one.
 */
async function writeAtomic(file: string, contents: string) {
  const temp = `${file}.${randomUUID()}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  try {
    await fs.writeFile(temp, contents, "utf8")
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
}

/** Indented, so the file stays reviewable in a diff. */
function stringify(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`
}
