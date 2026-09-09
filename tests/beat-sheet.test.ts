import { describe, expect, test } from "bun:test"

import {
  chooseCard,
  distributeText,
  fillSlots,
  NoMatchingCardError,
  realizeScene,
  SlotConstraintError,
} from "../src/mastra/lib/beat-sheet"
import { resolveStyle } from "../src/mastra/lib/style"
import type { ChannelStyle, SceneType, StoredScene } from "../src/mastra/schemas"

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

const SCENE_TYPES: SceneType[] = ["diagram", "code", "data", "process", "concept"]

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
    const narrow: ChannelStyle = {
      ...style,
      cards: style.cards.filter((card) => card.purpose === "concept"),
    }

    expect(() => chooseCard(scene({ type: "data" }), narrow)).toThrow(
      NoMatchingCardError
    )
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
    const s = scene({ type: "concept", coversLine: "A short headline.", scriptStart: 42 })
    const card = chooseCard(s, style)

    const entry = fillSlots(s, card)

    expect(entry.cardId).toBe(card.id)
    expect(entry.slots).toEqual([{ slotId: "headline", text: "A short headline." }])
    expect(entry.entryAt).toBe(42)
  })

  test("throws SlotConstraintError when the text overflows maxLength", () => {
    const tinyCard = {
      id: "tiny",
      tier: "primary" as const,
      purpose: "concept" as const,
      slots: [{ id: "headline", type: "text" as const, maxLength: 5 }],
    }
    const s = scene({ coversLine: "Way too long for this slot." })

    expect(() => fillSlots(s, tinyCard)).toThrow(SlotConstraintError)
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

  test("no matching card: failed, explicit error, no beat sheet entry", () => {
    const narrow: ChannelStyle = {
      ...style,
      cards: style.cards.filter((card) => card.purpose === "concept"),
    }
    const s = scene({ type: "data" })

    const result = realizeScene(s, narrow)

    expect(result.status).toBe("failed")
    expect(result.error).toMatch(/No card of purpose "data"/)
    expect(result.beatSheetEntry).toBeNull()
  })

  test("slot overflow: failed, explicit error, no beat sheet entry", () => {
    const overflowStyle: ChannelStyle = {
      ...style,
      cards: [
        {
          id: "tiny",
          tier: "primary",
          purpose: "concept",
          slots: [{ id: "headline", type: "text", maxLength: 3 }],
        },
      ],
    }
    const s = scene({ type: "concept", coversLine: "Way too long for this slot." })

    const result = realizeScene(s, overflowStyle)

    expect(result.status).toBe("failed")
    expect(result.error).toMatch(/Slot "headline" allows at most 3/)
    expect(result.beatSheetEntry).toBeNull()
  })
})
