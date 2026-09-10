/**
 * The one-way boundary with the external HyperFrames engine (issue #29).
 *
 * HyperFrames is not vendored here, and no SDK for it ships in this repo —
 * building the actual engine integration is outside what this issue asks for
 * (issue #23's chantier only covers the app's side of the seam: cut video +
 * remapped beat sheet in, one finished video out). So this module defines the
 * *contract* as an injectable interface rather than a concrete client: what
 * `composeStep` (`steps/compose.ts`) needs from HyperFrames, and nothing about
 * how a real integration would reach it (CLI, HTTP, SDK — an engineering
 * decision for whoever wires the real one in).
 *
 * ADR-0007's constraint shapes the interface on purpose: the exchange is
 * one-way. `compose` takes a fresh export and returns a finished video path —
 * there is no method here that reads a HyperFrames project back. The app
 * never treats HyperFrames' own state as anything to reconcile with
 * `StoredProject`, which stays the only source of truth.
 */

import type { BeatSheetSlot, ChannelStyle } from "../schemas"

/** One beat sheet entry, placed at its remapped position on the cut video. */
export interface HyperFramesCardPlacement {
  /** The originating `StoredScene.id` — echoed back in a placement failure. */
  sceneId: string
  cardId: string
  slots: BeatSheetSlot[]
  /** Seconds into the cut video (`RemappedBeatSheetEntry.cutVideoAt`). */
  atSec: number
}

export interface HyperFramesComposeRequest {
  /** Absolute path to the already-cut source video (issue #27's `cut.mp4`). */
  cutVideoPath: string
  /** Just what a card placement needs — not the whole `ChannelStyle`. */
  style: Pick<ChannelStyle, "id" | "palette" | "fontStack" | "motion">
  cards: HyperFramesCardPlacement[]
  /** Where the finished, directly-publishable video should be written. */
  outputPath: string
}

export interface HyperFramesComposeResult {
  outputPath: string
}

/**
 * One card HyperFrames could not place — card unknown to its own deck, a
 * slot it expected missing, or any other per-card montage failure.
 *
 * A real client throws this (or an `AggregateError` of several) rather than
 * writing a partial `outputPath` — the acceptance criterion this exists for
 * is "reported explicitly, never a silently incomplete export".
 */
export class HyperFramesCardError extends Error {
  constructor(
    public readonly sceneId: string,
    public readonly cardId: string,
    reason: string
  ) {
    super(`HyperFrames could not place card "${cardId}" (${sceneId}): ${reason}`)
    this.name = "HyperFramesCardError"
  }
}

/** What `composeStep` needs from the engine — real client or a test double. */
export interface HyperFramesClient {
  compose(request: HyperFramesComposeRequest): Promise<HyperFramesComposeResult>
}

/**
 * The client used when nothing is injected — refuses rather than pretending
 * to render, since no real HyperFrames integration is wired into this repo
 * yet. Explicit failure here is the same posture as the rest of this issue's
 * error handling: a run that can't actually compose must say so, not produce
 * a fake or partial output.
 */
export const unconfiguredHyperFramesClient: HyperFramesClient = {
  async compose() {
    throw new Error(
      "No HyperFrames client configured — composeStep needs a HyperFramesClient " +
        "wired in (e.g. via `videotool.config`) before it can render a final video."
    )
  },
}

/**
 * `composeStep`'s client, swappable the same way `style.ts`'s `STYLES` is —
 * a real engine has nowhere else to be wired in yet (no config file or env
 * var for it exists in this repo), and tests inject a fake rather than
 * reaching into module state directly.
 */
let activeClient: HyperFramesClient = unconfiguredHyperFramesClient

export function resolveHyperFramesClient(): HyperFramesClient {
  return activeClient
}

/** Test-only seam. Returns the undo, same contract as `registerStyleForTest`. */
export function registerHyperFramesClientForTest(
  client: HyperFramesClient
): () => void {
  const previous = activeClient
  activeClient = client
  return () => {
    activeClient = previous
  }
}
