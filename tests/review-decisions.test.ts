import { describe, expect, test } from "bun:test"

import { applyPatch } from "../lib/run-reducer"
import { sceneCounts, withDecisions } from "../lib/project"
import type { SceneDecision } from "../src/mastra/stream/contract"
import type { Project, Scene, SceneStatus } from "../lib/types"

function scene(id: string, status: SceneStatus, start: number): Scene {
  return {
    id,
    scriptStart: start,
    scriptEnd: start + 20,
    windowSec: 20,
    coversLine: `line for ${id}`,
    sourceFile: "01.MP4",
    intent: "something visual",
    type: "concept",
    status,
    htmlPath: "scenes/x.html",
    exportPath: null,
    measuredDurationSec: 3,
    html: "<html></html>",
  }
}

/** Only the fields this merge touches — the rest never leaves `fromDisk`. */
function project(scenes: Scene[]): Project {
  return { scenes } as unknown as Project
}

function decisions(...list: SceneDecision[]): Record<string, SceneDecision> {
  return Object.fromEntries(list.map((decision) => [decision.id, decision]))
}

const onDisk = project([
  scene("scene_01", "ready", 0),
  scene("scene_02", "ready", 20),
])

describe("withDecisions", () => {
  test("shows an approval on the scene the user clicked", () => {
    const decided = withDecisions(
      onDisk,
      decisions({ id: "scene_01", action: "approve" })
    )

    expect(decided.scenes[0].status).toBe("approved")
    expect(decided.scenes[1].status).toBe("ready")
  })

  test("shows a rejection, and a regeneration as being written", () => {
    const decided = withDecisions(
      onDisk,
      decisions(
        { id: "scene_01", action: "reject" },
        { id: "scene_02", action: "regenerate", note: "too fast" }
      )
    )

    expect(decided.scenes[0].status).toBe("rejected")
    expect(decided.scenes[1].status).toBe("generating")
    expect(decided.scenes[1].note).toBe("too fast")
  })

  test("survives a live run resending the same scenes", () => {
    // The regression. The run's patch carries the whole scenes array, so a
    // decision merged before it used to be replaced the moment the stream
    // re-reported a scene as `ready` — which is every render at the gate.
    const fromRun = {
      scenes: [scene("scene_01", "ready", 0), scene("scene_02", "ready", 20)],
    }

    const decided = withDecisions(
      applyPatch(onDisk, fromRun),
      decisions({ id: "scene_01", action: "approve" })
    )

    expect(decided.scenes[0].status).toBe("approved")
    expect(sceneCounts(decided.scenes).approved).toBe(1)
  })

  test("hands the scene back once the decision is submitted", () => {
    // Submitting clears the decisions, and the run's own statuses take over.
    const cleared = withDecisions(onDisk, {})

    expect(cleared.scenes.map((s) => s.status)).toEqual(["ready", "ready"])
    expect(cleared).toBe(onDisk)
  })

  test("shows the model a scene was sent back to, before the run confirms it", () => {
    const decided = withDecisions(
      onDisk,
      decisions({
        id: "scene_01",
        action: "regenerate",
        model: "openrouter/anthropic/claude-opus-5",
      })
    )

    expect(decided.scenes[0].model).toBe("openrouter/anthropic/claude-opus-5")
  })

  test("keeps the model that wrote a scene when a decision names none", () => {
    // Approve and reject carry no model, and must not blank the field — the
    // row would stop saying what wrote the version being approved.
    const generated = project([
      { ...scene("scene_01", "ready", 0), model: "openrouter/x-ai/grok-4.20" },
    ])

    const decided = withDecisions(
      generated,
      decisions({ id: "scene_01", action: "approve" })
    )

    expect(decided.scenes[0].model).toBe("openrouter/x-ai/grok-4.20")
  })

  test("ignores a decision for a scene that is no longer there", () => {
    const decided = withDecisions(
      onDisk,
      decisions({ id: "gone", action: "approve" })
    )

    expect(decided.scenes).toHaveLength(2)
    expect(decided.scenes.every((s) => s.status === "ready")).toBe(true)
  })
})
