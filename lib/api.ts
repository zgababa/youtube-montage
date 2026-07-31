/**
 * The single seam between the UI and the pipeline.
 *
 * Today every function returns fixtures from `lib/mock-data.ts`. When the
 * Mastra workflow and the routes in idea.md §8 exist, each body becomes a
 * `fetch` (or a direct `mastra.getWorkflow(...)` call in a server component)
 * and nothing above this file changes.
 */

import {
  MOCK_BROWSE_ROOT,
  MOCK_PROJECT,
  MOCK_PROJECTS,
  MOCK_RUN,
  mockBrowse,
} from "@/lib/mock-data"
import type { DirListing, Project, ProjectSummary, Run } from "@/lib/types"

/** GET /api/projects */
export async function listProjects(): Promise<ProjectSummary[]> {
  return MOCK_PROJECTS
}

/** GET /api/projects/[id] — reads the project's `project.json`. */
export async function getProject(id: string): Promise<Project | null> {
  if (id !== MOCK_PROJECT.id) return null
  return MOCK_PROJECT
}

/** GET /api/runs/[id] — latest run for a project, or null if it never ran. */
export async function getLatestRun(projectId: string): Promise<Run | null> {
  if (projectId !== MOCK_PROJECT.id) return null
  return MOCK_RUN
}

/** GET /api/browse — client-side, drives the folder picker. */
export async function browse(path: string): Promise<DirListing> {
  return mockBrowse(path)
}

export const BROWSE_ROOT = MOCK_BROWSE_ROOT
