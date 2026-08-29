/**
 * Where things live on disk.
 *
 * One rule from idea.md worth restating here, because breaking it is quiet
 * and painful: intermediate media — extracted audio, frame PNGs — goes to
 * `os.tmpdir()`, never inside the project (§8). A single 7-second scene is
 * 210 PNGs; the Next dev server watching those falls over.
 */

import os from "node:os"
import path from "node:path"

/**
 * `~/.videotool` — app-owned, outside any project.
 *
 * `VIDEOTOOL_HOME` overrides it. That exists so tests can point the whole app
 * at a scratch directory: they otherwise resolve the *real* one and delete a
 * real project list, which `os.homedir()` makes easy to do by accident — it
 * reads the system's passwd entry, so setting `process.env.HOME` in a test does
 * not redirect it.
 */
export const APP_DIR =
  process.env.VIDEOTOOL_HOME ?? path.join(os.homedir(), ".videotool")

/** The disposable projects index (idea.md §7). */
export const PROJECTS_INDEX = path.join(APP_DIR, "projects.json")

/** A project's source of truth, inside the project folder. */
export function projectFile(projectPath: string) {
  return path.join(projectPath, "project.json")
}

export function scenesDir(projectPath: string) {
  return path.join(projectPath, "scenes")
}

export function titlesDir(projectPath: string) {
  return path.join(projectPath, "titles")
}

export function exportsDir(projectPath: string) {
  return path.join(projectPath, "exports")
}

/** Where a rendered asset's HTML and export live, given its own subfolder and id. */
function assetHtmlPath(dir: string, id: string) {
  return path.join(dir, `${id}.html`)
}

function assetExportPath(projectPath: string, id: string) {
  return path.join(exportsDir(projectPath), `${id}.mov`)
}

export function sceneHtmlPath(projectPath: string, sceneId: string) {
  return assetHtmlPath(scenesDir(projectPath), sceneId)
}

export function sceneExportPath(projectPath: string, sceneId: string) {
  return assetExportPath(projectPath, sceneId)
}

export function titleHtmlPath(projectPath: string, annotationId: string) {
  return assetHtmlPath(titlesDir(projectPath), annotationId)
}

export function titleExportPath(projectPath: string, annotationId: string) {
  return assetExportPath(projectPath, annotationId)
}

function safeTitleElementId(elementId: string) {
  return `plan_${elementId.replace(/[^a-zA-Z0-9_-]/g, "_")}`
}

/** Paths for deterministic title assets owned by an editing-plan element. */
export function titleElementHtmlPath(projectPath: string, elementId: string) {
  return assetHtmlPath(titlesDir(projectPath), safeTitleElementId(elementId))
}

export function titleElementExportPath(projectPath: string, elementId: string) {
  return assetExportPath(projectPath, safeTitleElementId(elementId))
}

/**
 * A plain white clip the composite gate backs scene overlays with
 * (`white-backing.ts`) — one file, sliced to whatever length each fragment
 * needs. Underscore-prefixed so it never collides with a `scene_NN.mov` and
 * reads as generated rather than as a scene.
 */
export function whiteBackingPath(projectPath: string) {
  return path.join(exportsDir(projectPath), "_white-backing.mov")
}

export function shotlistPath(projectPath: string) {
  return path.join(projectPath, "shotlist.txt")
}

export function fcpxmlPath(projectPath: string) {
  return path.join(projectPath, "timeline.fcpxml")
}

/** Paths stored in `project.json` are relative, so projects stay portable. */
export function toRelative(projectPath: string, absolute: string) {
  return path.relative(projectPath, absolute)
}

export function toAbsolute(projectPath: string, relative: string) {
  return path.isAbsolute(relative) ? relative : path.join(projectPath, relative)
}

/** Scratch space for one run's intermediates. Caller cleans up. */
export function tmpDir(...segments: string[]) {
  return path.join(os.tmpdir(), "videotool", ...segments)
}
