/**
 * The client's calls into the app's own routes.
 *
 * Separate from `lib/api.ts` because that one reads the filesystem directly and
 * is server-only. These go over HTTP, from components running in the browser.
 */

import type { DirListing, ProjectSummary } from "@/lib/types"

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
