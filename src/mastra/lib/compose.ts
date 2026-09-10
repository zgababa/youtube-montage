/**
 * The cut video and the remapped beat sheet, handed to HyperFrames for the
 * final composite (issue #29) — in place of `overlay.ts`'s old FCPXML
 * rewrite.
 *
 * Split the same way `cut.ts` is, per issue #27's precedent: `buildComposeRequest`
 * is pure — a `StoredProject` in, the request HyperFrames needs out — so it's
 * testable on in-memory fixtures without a real engine. `composeVideo` is the
 * one impure line that hands that request to whatever `HyperFramesClient` is
 * injected.
 */

import { cutVideoPath, finalVideoPath } from "./paths"
import { resolveStyle } from "./style"
import { keptRunsForProject, remapBeatSheetTiming } from "./timeline"
import type { BeatSheetSceneTiming } from "./timeline"
import type {
  HyperFramesCardPlacement,
  HyperFramesClient,
  HyperFramesComposeRequest,
} from "./hyperframes"
import type { StoredProject } from "../schemas"

/** A realized, approved B-roll scene — the only kind `compose` places. */
function realizedScenes(project: StoredProject) {
  return project.scenes.filter(
    (scene) => scene.status === "approved" && scene.beatSheetEntry !== null
  )
}

export interface ComposeRequestResult {
  request: HyperFramesComposeRequest
  /**
   * Scene ids whose beat sheet entry couldn't be placed on the cut video
   * (`BeatSheetTimingError`, issue #28) — reported rather than silently
   * dropped, same posture as `placeOverlays`'s own `skipped` list.
   */
  skipped: string[]
}

/**
 * Builds the request HyperFrames needs: every realized scene's card and
 * slots, at its remapped position on the cut video.
 *
 * A scene whose window can't be placed (removed by the cut, or overlapping
 * one) is reported in `skipped` rather than thrown on — one bad scene out of
 * a dozen shouldn't stop the rest from composing, mirroring `overlay.ts`'s
 * old behaviour for the same reason.
 */
export function buildComposeRequest(project: StoredProject): ComposeRequestResult {
  const realized = realizedScenes(project)
  const runs = keptRunsForProject(project, project.maxSilenceSec)

  const timings: BeatSheetSceneTiming[] = realized.map((scene) => ({
    id: scene.id,
    sourceFile: scene.sourceFile,
    scriptStart: scene.scriptStart,
    windowSec: scene.windowSec,
  }))

  const { remapped, errors } = remapBeatSheetTiming(runs, timings)
  const byId = new Map(realized.map((scene) => [scene.id, scene]))

  const cards: HyperFramesCardPlacement[] = remapped.map((entry) => {
    const scene = byId.get(entry.id)!
    const beatSheetEntry = scene.beatSheetEntry!
    return {
      sceneId: scene.id,
      cardId: beatSheetEntry.cardId,
      slots: beatSheetEntry.slots,
      atSec: entry.cutVideoAt,
    }
  })

  const style = resolveStyle(project.styleRef)

  return {
    request: {
      cutVideoPath: cutVideoPath(project.path),
      style: {
        id: style.id,
        palette: style.palette,
        fontStack: style.fontStack,
        motion: style.motion,
      },
      cards,
      outputPath: finalVideoPath(project.path),
    },
    skipped: errors.map((error) => error.entryId),
  }
}

export interface ComposeResult {
  outputPath: string
  placedCount: number
  skipped: string[]
}

/**
 * Hands the cut video and remapped beat sheet to `client`, and returns where
 * the finished, publishable video landed.
 *
 * One-way by construction (ADR-0007): `client.compose` takes a fresh request
 * and returns a path, nothing here ever reads a HyperFrames project back to
 * reconcile against `StoredProject`.
 */
export async function composeVideo(
  project: StoredProject,
  client: HyperFramesClient
): Promise<ComposeResult> {
  const { request, skipped } = buildComposeRequest(project)
  const { outputPath } = await client.compose(request)

  return { outputPath, placedCount: request.cards.length, skipped }
}
