import "server-only"

/**
 * The seam between the UI and the pipeline.
 *
 * These were fixtures while the UI was built; they now read the real thing.
 * Nothing above this file changed when they were swapped, which is what the
 * seam was for.
 *
 * Server-only: it reaches into `src/mastra`, which pulls in `node:fs` and the
 * LibSQL client. The `server-only` import turns an accidental client import
 * into a build error rather than a confusing runtime one.
 */

import { mastra } from "@/src/mastra"
import { readProject, tryReadStoredProject } from "@/src/mastra/lib/project"
import { findById, readIndex, touch } from "@/src/mastra/lib/projects-index"
import type { Project, ProjectSummary } from "@/lib/types"

/** Every folder the app knows about, most recently opened first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const entries = await readIndex()

  const summaries = await Promise.all(
    entries.map(async (entry): Promise<ProjectSummary | null> => {
      const stored = await tryReadStoredProject(entry.path)
      // A folder that's in the index but has no readable project.json is a
      // half-created project. Skip it rather than showing a broken card.
      if (!stored) return null

      const exported = stored.scenes.filter(
        (scene) => scene.status === "exported"
      ).length

      return {
        id: entry.id,
        name: stored.name,
        path: entry.path,
        createdAt: stored.createdAt,
        lastOpened: entry.lastOpened,
        sceneCount: stored.scenes.length,
        exportedCount: exported,
        thumbnailHtml: await thumbnailFor(entry.path, stored.scenes),
      }
    })
  )

  return summaries
    .filter((summary): summary is ProjectSummary => summary !== null)
    .sort((a, b) => b.lastOpened.localeCompare(a.lastOpened))
}

/** The project's `project.json`, with each scene's HTML read in. */
export async function getProject(id: string): Promise<Project | null> {
  const entry = await findById(id)
  if (!entry) return null

  try {
    const project = await readProject(entry.path)
    await touch(id)
    // The id in the index is the app's handle on the folder; the one inside
    // `project.json` came from whichever machine created it. The index wins,
    // or moving a folder between machines breaks every URL.
    return { ...project, id, path: entry.path }
  } catch {
    return null
  }
}

/**
 * The most recent run left suspended at a gate for this project, if any —
 * what lets the page reconnect to it instead of starting a new one on
 * reload (idea.md §9, issue #3).
 *
 * Correlated by `resourceId`, which `usePipeline`'s "start" action sets to
 * the project path. A project whose run predates that wiring — or that has
 * none — simply has nothing to reconnect to.
 */
export async function getSuspendedRunId(
  projectPath: string
): Promise<string | null> {
  const { runs } = await mastra.getWorkflow("brollWorkflow").listWorkflowRuns({
    resourceId: projectPath,
    status: "suspended",
    perPage: 20,
  })

  if (runs.length === 0) return null

  // The most recent, in case more than one suspended run exists for the same
  // project — e.g. an old orphan from before this correlation existed.
  return runs.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    .runId
}

/**
 * The first scene with HTML, for the list thumbnail.
 *
 * Reading one file rather than hydrating the whole project: the projects list
 * shows one frame per card, and a project with twelve scenes shouldn't read
 * twelve HTML files to render a single thumbnail.
 */
async function thumbnailFor(
  projectPath: string,
  scenes: { htmlPath: string | null; status: string }[]
): Promise<string | null> {
  const { readSceneHtml } = await import("@/src/mastra/lib/project")
  const candidate =
    scenes.find(
      (scene) =>
        scene.htmlPath && ["approved", "exported"].includes(scene.status)
    ) ?? scenes.find((scene) => scene.htmlPath)

  return candidate ? readSceneHtml(projectPath, candidate.htmlPath) : null
}
