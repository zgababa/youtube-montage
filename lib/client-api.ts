/**
 * The client's calls into the app's own routes.
 *
 * Separate from `lib/api.ts` because that one reads the filesystem directly and
 * is server-only. These go over HTTP, from components running in the browser.
 */

import type { DirListing, Project, ProjectSummary } from "@/lib/types"

/**
 * Where the folder picker opens.
 *
 * The server decides — the browser has no idea what a home directory is on
 * this machine, and hard-coding one would be wrong on the first Windows or
 * Linux install.
 */
export async function browseHome(): Promise<DirListing> {
  return request<DirListing>("/api/browse")
}

export async function browse(path: string): Promise<DirListing> {
  return request<DirListing>(`/api/browse?path=${encodeURIComponent(path)}`)
}

/** Registers a folder and creates its `project.json` if there isn't one. */
export async function addProject(path: string): Promise<ProjectSummary> {
  return request<ProjectSummary>("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  })
}

/**
 * Saves the settings a run reads: media roles and sync, fps, style guide.
 *
 * Everything else on a project is pipeline output; the route whitelists these
 * three and drops the rest rather than letting a client overwrite results.
 */
export async function saveProject(
  id: string,
  patch: Partial<
    Pick<
      Project,
      | "media"
      | "transcriptionHints"
      | "fps"
      | "styleGuide"
      | "editingDocument"
      | "sourceScript"
    >
  >
): Promise<Project> {
  return request<Project>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  })
}

/**
 * Forgets a folder. Returns its path, so the caller can offer to undo.
 *
 * Removes the app's index entry and nothing else — the footage, `project.json`
 * and every export stay on disk. Re-adding the same path brings it all back.
 */
export async function removeProject(id: string): Promise<{ path: string }> {
  return request<{ path: string }>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

/**
 * Writes the cut timeline and recomposites it, in one request (ADR 0009).
 *
 * Not a workflow gate: deterministic and cheap, so it's a plain action
 * available any time, not tied to a live run being suspended anywhere.
 */
export async function updateTimeline(
  id: string,
  maxSilenceSec?: number
): Promise<Project> {
  return request<Project>(`/api/projects/${encodeURIComponent(id)}/timeline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(maxSilenceSec ? { maxSilenceSec } : {}),
  })
}

/** `open -R` on a path — the "show in Finder" affordance (idea.md §8). */
export async function reveal(path: string): Promise<void> {
  await request("/api/reveal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  })
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    // These routes answer with `{ error }` on failure; fall back to the status
    // line when something else went wrong (a proxy, a crash before the handler).
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<T>
}
