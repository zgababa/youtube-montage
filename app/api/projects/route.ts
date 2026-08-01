/**
 * The projects list, and adding a folder to it.
 *
 * Adding a project registers a path — it never copies or moves anything
 * (idea.md §2). `project.json` itself is created by the workflow's first step,
 * so a folder added here and never run is simply a folder the app remembers.
 */

import fs from "node:fs/promises"
import path from "node:path"

import {
  blankProject,
  createProject,
  tryReadStoredProject,
} from "@/src/mastra/lib/project"
import { addToIndex } from "@/src/mastra/lib/projects-index"
import { listProjects } from "@/lib/api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json(await listProjects())
}

export async function POST(request: Request) {
  const { path: requested } = (await request.json()) as { path?: string }

  if (!requested?.trim()) {
    return Response.json({ error: "path is required" }, { status: 400 })
  }

  const projectPath = path.resolve(requested.trim())

  const stats = await fs.stat(projectPath).catch(() => null)
  if (!stats?.isDirectory()) {
    return Response.json(
      { error: `${projectPath} is not a folder` },
      { status: 400 }
    )
  }

  const entry = await addToIndex(projectPath)

  // Create the file if the folder doesn't have one. Without this the folder is
  // indexed but invisible — `listProjects` drops entries with no readable
  // `project.json`, so there's no card to click, and the only way to create one
  // was to run the pipeline, which needs the card. Adding a folder in the UI
  // dead-ended there.
  if (!(await tryReadStoredProject(projectPath))) {
    await createProject(projectPath, blankProject(projectPath))
  }

  const projects = await listProjects()
  const summary = projects.find((project) => project.id === entry.id)

  // A summary can still be missing if the file was written but is unreadable —
  // a folder from another tool with its own `project.json`, say. Answer with a
  // placeholder rather than an error; the projects list will show what it can.
  return Response.json(
    summary ?? {
      id: entry.id,
      name: path.basename(projectPath),
      path: projectPath,
      createdAt: entry.lastOpened,
      lastOpened: entry.lastOpened,
      sceneCount: 0,
      exportedCount: 0,
      thumbnailHtml: null,
    }
  )
}
