import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  chooseCard,
  distributeText,
  fillSlots,
  NoMatchingCardError,
  realizeScene,
  SlotConstraintError,
  SlotTypeError,
} from "../src/mastra/lib/beat-sheet"
import {
  blankProject,
  createProject,
  readStoredProject,
} from "../src/mastra/lib/project"
import { registerStyleForTest, resolveStyle } from "../src/mastra/lib/style"
import { generateAndPersistScene } from "../src/mastra/steps/generate-scene"
import type {
  ChannelStyle,
  SceneType,
  StoredScene,
  StyleCard,
} from "../src/mastra/schemas"

function scene(overrides: Partial<StoredScene> = {}): StoredScene {
  return {
    id: "scene_01",
    scriptStart: 12,
    scriptEnd: 18,
    windowSec: 6,
    coversLine: "The agent picks up the job from the queue.",
    sourceFile: "01.MP4",
    intent: "explain the queue",
    type: "concept",
    status: "pending",
    htmlPath: null,
    exportPath: null,
    measuredDurationSec: null,
    beatSheetEntry: null,
    ...overrides,
  }
}

/** A single-slot "concept" card whose slot only allows `maxLength` chars. */
function tinyCard(maxLength: number): StyleCard {
  return {
    id: "tiny",
    tier: "primary",
    purpose: "concept",
    slots: [{ id: "headline", type: "text", maxLength }],
  }
}

/** A single-slot "process" card whose slot expects list-shaped text. */
function listCard(): StyleCard {
  return {
    id: "steps-list",
    tier: "primary",
    purpose: "process",
    slots: [{ id: "steps", type: "list", maxLength: 200 }],
  }
}

/**
 * The default deck with every card of `purpose` removed — the shape every
 * "no card fits this scene" test needs.
 */
function styleWithout(purpose: SceneType): ChannelStyle {
  const style = resolveStyle("default")
  return {
    ...style,
    cards: style.cards.filter((card) => card.purpose !== purpose),
  }
}

const SCENE_TYPES: SceneType[] = [
  "diagram",
  "code",
  "data",
  "process",
  "concept",
]

describe("resolveStyle", () => {
  test("the default style has a card for every scene type", () => {
    const style = resolveStyle("default")
    const purposes = new Set(style.cards.map((card) => card.purpose))
    for (const type of SCENE_TYPES) {
      expect(purposes.has(type)).toBe(true)
    }
  })

  test("throws on an unknown reference", () => {
    expect(() => resolveStyle("nope")).toThrow(/Unknown style reference "nope"/)
  })
})

describe("chooseCard", () => {
  const style = resolveStyle("default")

  test("picks the card matching the scene's type", () => {
    const card = chooseCard(scene({ type: "data" }), style)
    expect(card.purpose).toBe("data")
  })

  test("throws NoMatchingCardError when no card fits the purpose", () => {
    expect(() =>
      chooseCard(scene({ type: "data" }), styleWithout("data"))
    ).toThrow(NoMatchingCardError)
  })
})

describe("distributeText", () => {
  test("a single slot gets the whole trimmed text", () => {
    expect(distributeText("  One sentence.  ", 1)).toEqual(["One sentence."])
  })

  test("splits sentences one per slot when counts match", () => {
    expect(distributeText("First one. Second one.", 2)).toEqual([
      "First one.",
      "Second one.",
    ])
  })

  test("pads remaining slots with empty strings when there are fewer sentences", () => {
    expect(distributeText("Only one sentence here.", 3)).toEqual([
      "Only one sentence here.",
      "",
      "",
    ])
  })

  test("the last slot absorbs everything left over when there are more sentences", () => {
    expect(distributeText("One. Two. Three. Four.", 2)).toEqual([
      "One.",
      "Two. Three. Four.",
    ])
  })
})

describe("fillSlots", () => {
  const style = resolveStyle("default")

  test("fills the chosen card's slots and anchors entryAt on scriptStart", () => {
    const s = scene({
      type: "concept",
      coversLine: "A short headline.",
      scriptStart: 42,
    })
    const card = chooseCard(s, style)

    const entry = fillSlots(s, card)

    expect(entry.cardId).toBe(card.id)
    expect(entry.slots).toEqual([
      { slotId: "headline", text: "A short headline." },
    ])
    expect(entry.entryAt).toBe(42)
  })

  test("throws SlotConstraintError when the text overflows maxLength", () => {
    const s = scene({ coversLine: "Way too long for this slot." })

    expect(() => fillSlots(s, tinyCard(5))).toThrow(SlotConstraintError)
  })

  // Issue #26: a slot declares "list" but the filled text is a single
  // free-text sentence — not the multiple delimited items a list slot
  // expects.
  test("throws SlotTypeError when a list slot is filled with plain free text", () => {
    const s = scene({
      type: "process",
      coversLine: "Just one plain sentence, no items here.",
    })

    expect(() => fillSlots(s, listCard())).toThrow(SlotTypeError)
  })

  // The other direction of the same mismatch: a "text" slot expects one
  // free-form line, not multiple delimited items.
  test("throws SlotTypeError when a text slot is filled with list-shaped text", () => {
    const s = scene({
      type: "concept",
      coversLine: "- First item\n- Second item\n- Third item",
    })

    expect(() => fillSlots(s, tinyCard(200))).toThrow(SlotTypeError)
  })

  // Only item *separators* make a list. A semicolon joins clauses inside one
  // spoken sentence, and every shipped card declares "text" — reading it as a
  // delimiter would fail ordinary script lines.
  test("prose punctuation is not a list: a semicolon never trips a text slot", () => {
    const s = scene({
      type: "concept",
      coversLine: "On ouvre le capot ; puis on vérifie l'huile.",
    })

    const entry = fillSlots(s, tinyCard(200))

    expect(entry.slots).toEqual([
      {
        slotId: "headline",
        text: "On ouvre le capot ; puis on vérifie l'huile.",
      },
    ])
  })

  test("an empty padded slot never trips the type check, regardless of type", () => {
    const twoSlotCard: StyleCard = {
      id: "two-slots",
      tier: "primary",
      purpose: "concept",
      slots: [
        { id: "first", type: "text", maxLength: 200 },
        { id: "second", type: "list", maxLength: 200 },
      ],
    }
    const s = scene({ type: "concept", coversLine: "Only one sentence." })

    const entry = fillSlots(s, twoSlotCard)

    expect(entry.slots).toEqual([
      { slotId: "first", text: "Only one sentence." },
      { slotId: "second", text: "" },
    ])
  })
})

describe("realizeScene", () => {
  const style = resolveStyle("default")

  test("happy path: ready, beat sheet entry set, old-mechanism fields cleared", () => {
    const s = scene({ type: "concept", coversLine: "A short headline." })

    const result = realizeScene(s, style)

    expect(result.status).toBe("ready")
    expect(result.beatSheetEntry).not.toBeNull()
    expect(result.beatSheetEntry?.cardId).toBe("concept-headline")
    expect(result.htmlPath).toBeNull()
    expect(result.exportPath).toBeNull()
    expect(result.measuredDurationSec).toBeNull()
    expect(result.model).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  // Realization failures (no matching card, slot overflow) propagate rather
  // than being caught here — `generateAndPersistScene` is the single place
  // that turns a thrown error into a persisted `failed` scene (see the
  // "generateAndPersistScene" describe block below), so `realizeScene` itself
  // is only ever tested for the happy path plus the fact that it throws.

  test("no matching card throws NoMatchingCardError", () => {
    const s = scene({ type: "data" })

    expect(() => realizeScene(s, styleWithout("data"))).toThrow(
      NoMatchingCardError
    )
  })

  test("slot overflow throws SlotConstraintError", () => {
    const overflowStyle: ChannelStyle = {
      ...style,
      cards: [tinyCard(3)],
    }
    const s = scene({
      type: "concept",
      coversLine: "Way too long for this slot.",
    })

    expect(() => realizeScene(s, overflowStyle)).toThrow(SlotConstraintError)
  })

  test("slot type mismatch throws SlotTypeError", () => {
    const listStyle: ChannelStyle = { ...style, cards: [listCard()] }
    const s = scene({
      type: "process",
      coversLine: "Just one plain sentence, no items here.",
    })

    expect(() => realizeScene(s, listStyle)).toThrow(SlotTypeError)
  })
})

/**
 * The regenerate seam, on a real project folder.
 *
 * `reviewStep` regenerates a scene by calling `generateAndPersistScene`
 * directly — the same function the `.foreach` runs — so this exercises the
 * criterion that asking for a regeneration produces a *new* beat sheet entry
 * through the same mechanism, and that a scene carrying leftovers from the old
 * HTML/Playwright path comes back with none of them.
 */
describe("generateAndPersistScene (the seam review regenerates through)", () => {
  const dirs: string[] = []
  const restoreStyles: Array<() => void> = []

  afterEach(async () => {
    // Styles first: `STYLES` is shared by every test file in the run, so a
    // style registered here must not stay resolvable once this block is done.
    for (const restore of restoreStyles.splice(0)) restore()
    await Promise.all(
      dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))
    )
  })

  async function projectWith(stored: StoredScene) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "beat-sheet-test-"))
    dirs.push(dir)
    await createProject(dir, { ...blankProject(dir), scenes: [stored] })
    return dir
  }

  test("regenerating replaces the beat sheet entry and drops old-mechanism fields", async () => {
    // A scene as the old path left it: rendered HTML, an export, a measured
    // duration and the model that wrote it.
    const stale = scene({
      type: "concept",
      coversLine: "A short headline.",
      status: "rejected",
      htmlPath: "scenes/scene_01.html",
      exportPath: "exports/scene_01.mov",
      measuredDurationSec: 6,
      model: "openrouter/google/gemini-3.6-flash",
      beatSheetEntry: { cardId: "stale-card", slots: [], entryAt: 0 },
    })
    const dir = await projectWith(stale)

    const result = await generateAndPersistScene(
      { projectPath: dir, scene: stale, styleRef: "default" },
      undefined
    )

    expect(result).toEqual({ id: "scene_01", status: "ready" })

    const [persisted] = (await readStoredProject(dir)).scenes
    expect(persisted.beatSheetEntry?.cardId).toBe("concept-headline")
    expect(persisted.beatSheetEntry?.slots).toEqual([
      { slotId: "headline", text: "A short headline." },
    ])
    expect(persisted.beatSheetEntry?.entryAt).toBe(stale.scriptStart)
    expect(persisted.htmlPath).toBeNull()
    expect(persisted.exportPath).toBeNull()
    expect(persisted.measuredDurationSec).toBeNull()
    expect(persisted.model).toBeUndefined()
  })

  test("an unresolvable styleRef fails just that scene, with the reason on it", async () => {
    const stored = scene({ model: "openrouter/google/gemini-3.6-flash" })
    const dir = await projectWith(stored)

    const result = await generateAndPersistScene(
      { projectPath: dir, scene: stored, styleRef: "nope" },
      undefined
    )

    expect(result.status).toBe("failed")

    const [persisted] = (await readStoredProject(dir)).scenes
    expect(persisted.error).toMatch(/Unknown style reference "nope"/)
    expect(persisted.beatSheetEntry).toBeNull()
    expect(persisted.model).toBeUndefined()
  })

  // Issue #25: no card in the resolved style matches the scene's intent —
  // this must fail the scene explicitly rather than force an unsuitable
  // card. Every `SceneType` has a card in the real "default" deck (see
  // `resolveStyle`'s own test above), so reaching this through the full
  // `generateAndPersistScene` seam — as opposed to `chooseCard`/`realizeScene`
  // directly, already covered above — needs a deck missing the "data" purpose
  // registered under a styleRef of its own, and removed again afterwards.
  test("no matching card fails just that scene, with the reason on it", async () => {
    restoreStyles.push(
      registerStyleForTest("no-data-card", {
        ...styleWithout("data"),
        id: "no-data-card",
      })
    )
    const stored = scene({ type: "data" })
    const dir = await projectWith(stored)

    const result = await generateAndPersistScene(
      { projectPath: dir, scene: stored, styleRef: "no-data-card" },
      undefined
    )

    expect(result.status).toBe("failed")

    const [persisted] = (await readStoredProject(dir)).scenes
    expect(persisted.error).toMatch(
      /No card of purpose "data" in style "no-data-card"/
    )
    expect(persisted.beatSheetEntry).toBeNull()
  })

  // Issue #26: a slot's filled text violates the card's declared constraint
  // (length or type) — must fail just that scene, explicitly, with no
  // silent truncation and no beat sheet entry persisted.
  test("slot constraint violation fails just that scene, with the reason on it", async () => {
    restoreStyles.push(
      registerStyleForTest("tiny-headline", {
        ...resolveStyle("default"),
        id: "tiny-headline",
        cards: [tinyCard(5)],
      })
    )
    const stored = scene({
      type: "concept",
      coversLine: "Way too long for this slot.",
    })
    const dir = await projectWith(stored)

    const result = await generateAndPersistScene(
      { projectPath: dir, scene: stored, styleRef: "tiny-headline" },
      undefined
    )

    expect(result.status).toBe("failed")

    const [persisted] = (await readStoredProject(dir)).scenes
    expect(persisted.error).toMatch(/Slot "headline" allows at most 5/)
    expect(persisted.beatSheetEntry).toBeNull()
  })

  test("slot type mismatch fails just that scene, with the reason on it", async () => {
    restoreStyles.push(
      registerStyleForTest("list-steps", {
        ...resolveStyle("default"),
        id: "list-steps",
        cards: [listCard()],
      })
    )
    const stored = scene({
      type: "process",
      coversLine: "Just one plain sentence, no items here.",
    })
    const dir = await projectWith(stored)

    const result = await generateAndPersistScene(
      { projectPath: dir, scene: stored, styleRef: "list-steps" },
      undefined
    )

    expect(result.status).toBe("failed")

    const [persisted] = (await readStoredProject(dir)).scenes
    expect(persisted.error).toMatch(/Slot "steps" expects "list"-shaped text/)
    expect(persisted.beatSheetEntry).toBeNull()
  })
})
