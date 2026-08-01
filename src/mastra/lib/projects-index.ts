/**
 * `~/.videotool/projects.json` — the list of folders the app knows about.
 *
 * Deliberately disposable (idea.md §7). It holds an id, a path, and a
 * timestamp; everything that matters lives in the project folders themselves.
 * Entries whose folders have gone are dropped on read, and the whole file is
 * rebuildable by re-adding folders — so losing it costs a few clicks.
 */

import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"

import { PROJECTS_INDEX, projectFile } from "./paths"
import { ProjectsIndexSchema, type ProjectsIndex } from "../schemas"

type Entry = ProjectsIndex["projects"][number]

/** Reads the index, dropping entries whose folders no longer exist. */
export async function readIndex(): Promise<Entry[]> {
  let parsed: ProjectsIndex
  try {
    const raw = await fs.readFile(PROJECTS_INDEX, "utf8")
    parsed = ProjectsIndexSchema.parse(JSON.parse(raw))
  } catch {
    // Missing or corrupt is the same thing here: start over. Nothing in this
    // file is worth recovering.
    return []
  }

  const alive = await Promise.all(
    parsed.projects.map(async (entry) =>
      (await exists(projectFile(entry.path))) ? entry : null
    )
  )
  return alive.filter((entry): entry is Entry => entry !== null)
}

/** Adds a folder, or returns the existing entry if it's already listed. */
export async function addToIndex(projectPath: string): Promise<Entry> {
  const entries = await readIndex()
  const existing = entries.find((entry) => entry.path === projectPath)

  const entry: Entry = existing
    ? { ...existing, lastOpened: new Date().toISOString() }
    : {
        id: randomUUID(),
        path: projectPath,
        lastOpened: new Date().toISOString(),
      }

  await write([entry, ...entries.filter((e) => e.path !== projectPath)])
  return entry
}

export async function touch(id: string): Promise<void> {
  const entries = await readIndex()
  await write(
    entries.map((entry) =>
      entry.id === id
        ? { ...entry, lastOpened: new Date().toISOString() }
        : entry
    )
  )
}

export async function findById(id: string): Promise<Entry | null> {
  const entries = await readIndex()
  return entries.find((entry) => entry.id === id) ?? null
}

async function write(projects: Entry[]) {
  await fs.mkdir(new URL(".", `file://${PROJECTS_INDEX}`).pathname, {
    recursive: true,
  })
  await fs.writeFile(
    PROJECTS_INDEX,
    `${JSON.stringify({ projects }, null, 2)}\n`,
    "utf8"
  )
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}
