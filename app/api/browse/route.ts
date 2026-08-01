/**
 * Directory listing for the folder picker.
 *
 * A server on localhost can't open a native file dialog, so adding a project
 * means walking the filesystem through here (idea.md §10).
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { projectFile } from "@/src/mastra/lib/paths"
import type { DirEntry, DirListing } from "@/lib/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("path")
  const dir = path.resolve(requested?.trim() || os.homedir())

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    const directories = await Promise.all(
      entries
        // Hidden folders are noise here — `~/Library`, `.git`, and friends
        // aren't where anyone keeps footage.
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry): Promise<DirEntry> => {
          const absolute = path.join(dir, entry.name)
          return {
            name: entry.name,
            path: absolute,
            hasProjectJson: await exists(projectFile(absolute)),
          }
        })
    )

    const parent = path.dirname(dir)

    const listing: DirListing = {
      path: dir,
      // `path.dirname("/")` is `"/"`, so compare rather than checking depth.
      parent: parent === dir ? null : parent,
      entries: directories.sort((a, b) => a.name.localeCompare(b.name)),
    }

    return Response.json(listing)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    )
  }
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}
