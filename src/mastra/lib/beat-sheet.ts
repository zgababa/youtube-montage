/**
 * Plan éditorial → Beat sheet (issue #24).
 *
 * The new B-roll realization mechanism: a `StoredScene` (an approved plan
 * element) plus a resolved `ChannelStyle` in, a `Beat sheet` entry out — a
 * chosen card, its slots filled from the scene's script line, and an entry
 * time anchored on the scene's `scriptStart`. Pure and synchronous: no LLM
 * call, no Chromium, deterministic given the same inputs (issue #22's
 * Testing Decisions).
 *
 * Replaces, for B-roll scenes, the old `sceneAgent` → `validateScene` →
 * Playwright render path.
 */

import type {
  BeatSheetEntry,
  ChannelStyle,
  StoredScene,
  StyleCard,
} from "../schemas"

/**
 * The old mechanism's output fields, blanked.
 *
 * A scene realized as a beat sheet entry has no generated HTML, no ProRes
 * export, no measured animation duration and no authoring model — and if it
 * carried any from a previous run on the old path, they are stale, not
 * history. Exported so the failure branch in `steps/generate-scene.ts` clears
 * exactly the same set: a scene must never come back half old, half new.
 */
export const CLEARED_RENDER_FIELDS = {
  htmlPath: null,
  exportPath: null,
  measuredDurationSec: null,
  model: undefined,
} satisfies Partial<StoredScene>

/** No card in the style matches the scene's intent/type (user story 9). */
export class NoMatchingCardError extends Error {
  constructor(sceneType: string, styleId: string) {
    super(
      `No card of purpose "${sceneType}" in style "${styleId}" — cannot realize this scene without forcing an unsuitable card.`
    )
    this.name = "NoMatchingCardError"
  }
}

/** A slot's filled text overflows its declared `maxLength` (user story 7). */
export class SlotConstraintError extends Error {
  constructor(slotId: string, maxLength: number, actualLength: number) {
    super(
      `Slot "${slotId}" allows at most ${maxLength} characters, got ${actualLength} — not truncating silently.`
    )
    this.name = "SlotConstraintError"
  }
}

/**
 * Picks the card for a scene: purpose must match the scene's `type`, primary
 * tier preferred, ties broken by ascending id so the choice is deterministic.
 */
export function chooseCard(scene: StoredScene, style: ChannelStyle): StyleCard {
  const candidates = style.cards.filter((card) => card.purpose === scene.type)
  if (candidates.length === 0) {
    throw new NoMatchingCardError(scene.type, style.id)
  }

  // Primary tier wins; ties broken by ascending id, so the pick is
  // deterministic without sorting the whole candidate list to read one entry.
  return candidates.reduce((best, card) => {
    if (card.tier !== best.tier) return card.tier === "primary" ? card : best
    return card.id < best.id ? card : best
  })
}

/**
 * Splits `text` across `slotCount` slots on sentence boundaries.
 *
 * Fewer sentences than slots: the remaining slots get `""` — a card asking
 * for more beats than the line has isn't an error, just sparse. More
 * sentences than slots: the last slot absorbs everything left over, joined
 * back with a space.
 */
export function distributeText(text: string, slotCount: number): string[] {
  const trimmed = text.trim()
  if (slotCount === 1) return [trimmed]

  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0)

  const parts: string[] = []
  for (let i = 0; i < slotCount; i++) {
    if (i === slotCount - 1) {
      parts.push(sentences.slice(i).join(" "))
    } else {
      parts.push(sentences[i] ?? "")
    }
  }
  return parts
}

/**
 * Fills `card`'s slots from `scene.coversLine` — the only free text a
 * `StoredScene` carries at this seam — and checks every slot's constraint.
 */
export function fillSlots(scene: StoredScene, card: StyleCard): BeatSheetEntry {
  const pieces = distributeText(scene.coversLine, card.slots.length)

  const slots = card.slots.map((slot, index) => {
    const text = pieces[index].trim()
    if (text.length > slot.maxLength) {
      throw new SlotConstraintError(slot.id, slot.maxLength, text.length)
    }
    return { slotId: slot.id, text }
  })

  return { cardId: card.id, slots, entryAt: scene.scriptStart }
}

/**
 * Realizes one scene: choose a card, fill its slots, return the scene ready
 * to persist.
 *
 * Throws — `NoMatchingCardError`, `SlotConstraintError`, or a resolution bug
 * — rather than catching anything itself. `generateAndPersistScene` (the
 * step's I/O shell) is the single place that turns a thrown error into an
 * explicit `failed` scene; duplicating that translation here as well would
 * split one concern across two altitudes for no observable difference, since
 * that shell already catches everything this function could throw.
 */
export function realizeScene(
  scene: StoredScene,
  style: ChannelStyle
): StoredScene {
  const card = chooseCard(scene, style)
  const beatSheetEntry = fillSlots(scene, card)

  return {
    ...scene,
    ...CLEARED_RENDER_FIELDS,
    status: "ready",
    error: undefined,
    beatSheetEntry,
  }
}
