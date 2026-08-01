/**
 * `~/.videotool/projects.json` — the list of folders the app knows about.
 *
 * "Disposable" (idea.md §7) describes what it *holds* — an id, a path and a
 * timestamp, all rebuildable by re-adding folders. It does not license losing
 * it: re-finding half a dozen folders in a file picker is a genuinely annoying
 * way to start a morning.
 *
 * Which matters, because the obvious implementation of this file loses the lot.
 * Every writer reads the whole list, derives a new one, and writes it back, so
 * anything that makes a read look empty gets *persisted* by the next write —
 * and reads happen constantly, since opening a project touches its timestamp.
 * Three things guard that:
 *
 *   - A read that fails for any reason other than "no file yet" throws. An
 *     unreadable index must never be mistaken for an empty one.
 *   - Writes are atomic, so a half-written file can't be read back as corrupt
 *     in the first place.
 *   - Writes are serialized, so two requests can't derive from the same
 *     snapshot and clobber each other.
 */

import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { PROJECTS_INDEX } from "./paths"
import { ProjectsIndexSchema, type ProjectsIndex } from "../schemas"

type Entry = ProjectsIndex["projects"][number]

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every entry, exactly as stored.
 *
 * Throws if the file exists but can't be read or parsed. That is the important
 * behaviour: the alternative — returning `[]` — is indistinguishable from a
 * genuinely empty list, and the next write turns a transient glitch into
 * permanent loss.
 */
async function readEntries(): Promise<Entry[]> {
  let raw: string
  try {
    raw = await fs.readFile(PROJECTS_INDEX, "utf8")
  } catch (error) {
    // No file yet is the first-run case and genuinely means no projects.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }

  try {
    return ProjectsIndexSchema.parse(JSON.parse(raw)).projects
  } catch (error) {
    throw new Error(
      `${PROJECTS_INDEX} is unreadable, so the project list can't be loaded without risking losing it. Fix or delete the file. (${(error as Error).message})`
    )
  }
}

/**
 * Every folder the app knows about.
 *
 * Entries whose folder has gone are *not* dropped here. They used to be, and
 * the filtered list was then written back by the next update — so a project on
 * an unplugged drive was silently forgotten for good. Callers that need to show
 * only openable projects filter for display; nothing filters for storage.
 */
export async function readIndex(): Promise<Entry[]> {
  return readEntries()
}

export async function findById(id: string): Promise<Entry | null> {
  const entries = await readEntries()
  return entries.find((entry) => entry.id === id) ?? null
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Adds a folder, or refreshes the one already listed.
 *
 * Newest first, which is the order the list is shown in.
 */
export async function addToIndex(projectPath: string): Promise<Entry> {
  return update((entries) => {
    const existing = entries.find((entry) => entry.path === projectPath)
    const entry: Entry = {
      id: existing?.id ?? randomUUID(),
      path: projectPath,
      lastOpened: new Date().toISOString(),
    }
    return {
      entries: [entry, ...entries.filter((e) => e.path !== projectPath)],
      result: entry,
    }
  })
}

export async function touch(id: string): Promise<void> {
  await update((entries) => {
    // Nothing to record, so nothing to write. Skipping the write matters more
    // than it looks: this runs on every project page load, and it's the write
    // most likely to be the one that persists a bad read.
    if (!entries.some((entry) => entry.id === id)) {
      return { entries: null, result: undefined }
    }
    return {
      entries: entries.map((entry) =>
        entry.id === id
          ? { ...entry, lastOpened: new Date().toISOString() }
          : entry
      ),
      result: undefined,
    }
  })
}

/**
 * Forgets a folder. Returns the entry that was dropped, or null.
 *
 * Index-only, and deliberately so — nothing on disk is touched. `project.json`,
 * `scenes/`, `exports/` and every frame of footage stay where they are, which
 * is what makes this safe to offer next to "open" and re-addable by pointing at
 * the same folder again. The tool never wrote the footage and has no business
 * deleting it.
 */
export async function removeFromIndex(id: string): Promise<Entry | null> {
  return update((entries) => {
    const removed = entries.find((entry) => entry.id === id)
    if (!removed) return { entries: null, result: null }
    return {
      entries: entries.filter((entry) => entry.id !== id),
      result: removed,
    }
  })
}

/* -------------------------------------------------------------------------- */
/* The write path                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One promise chain for the whole file.
 *
 * Read-derive-write can't interleave: two requests deriving from the same
 * snapshot means one of them is discarded, and adding a project while another
 * request touches a timestamp is an ordinary thing to happen.
 */
let queue: Promise<unknown> = Promise.resolve()

async function update<T>(
  mutate: (entries: Entry[]) => { entries: Entry[] | null; result: T }
): Promise<T> {
  const run = async () => {
    // Inside the queue, so the read that a write derives from can't be stale.
    // A throw here aborts before writing, which is the whole point.
    const { entries, result } = mutate(await readEntries())
    if (entries) await write(entries)
    return result
  }

  // Swallow the predecessor's rejection so one failure doesn't poison the rest.
  const next = queue.then(run, run)
  queue = next.catch(() => {})
  return next
}

/**
 * Rename-into-place, with the temp file alongside the target.
 *
 * A plain `writeFile` truncates first, so an interrupted write leaves a partial
 * file — which reads back as corrupt, and used to be silently treated as "no
 * projects".
 */
async function write(entries: Entry[]) {
  const directory = path.dirname(PROJECTS_INDEX)
  await fs.mkdir(directory, { recursive: true })

  const temp = path.join(directory, `.projects.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(
      temp,
      `${JSON.stringify({ projects: entries }, null, 2)}\n`,
      "utf8"
    )
    await fs.rename(temp, PROJECTS_INDEX)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
}
