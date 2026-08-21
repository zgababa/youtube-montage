import { describe, expect, test } from "bun:test"

import { focusStage, stageStates, STAGES } from "../lib/stages"
import { STEP_IDS } from "../src/mastra/stream/contract"
import type {
  Project,
  Run,
  RunStep,
  Scene,
  StepId,
  StepStatus,
} from "../lib/types"

function scene(id: string, status: Scene["status"]): Scene {
  return {
    id,
    scriptStart: 0,
    scriptEnd: 20,
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

/** Only the fields the derivation reads — nothing here touches the rest. */
function project(over: Partial<Project> = {}): Project {
  return {
    media: [],
    transcript: { words: [] },
    spans: [],
    cleanupApprovedAt: null,
    maxSilenceSec: 0.3,
    timelineApprovedAt: null,
    scenes: [],
    copy: null,
    styleGuide: { palette: ["#000"], fontStack: "Inter, sans-serif" },
    ...over,
  } as unknown as Project
}

/** A run where the named steps have the given status and the rest are pending. */
function run(statuses: Partial<Record<StepId, StepStatus>>): Run {
  return {
    id: "r1",
    status: "running",
    startedAt: "2026-08-02T10:00:00.000Z",
    suspendedOn: null,
    steps: STEP_IDS.map((id): RunStep => ({
      id,
      label: id,
      status: statuses[id] ?? "pending",
      log: [],
    })),
  }
}

function stage(id: string, project: Project, current: Run | null) {
  const found = stageStates(project, current).find((state) => state.id === id)
  if (!found) throw new Error(`no stage ${id}`)
  return found
}

describe("the stage list", () => {
  test("covers every pipeline step exactly once", () => {
    const owned = STAGES.flatMap((definition) => definition.steps)

    expect([...owned].sort()).toEqual([...STEP_IDS].sort())
  })

  test("never claims the style guide ran, because it isn't a step", () => {
    // It's an input the user sets, not a phase. With no steps of its own an
    // "are they all done?" roll-up would otherwise call it finished on load,
    // and finished again after a run it took no part in.
    const everything = run(
      Object.fromEntries(STEP_IDS.map((id) => [id, "success" as StepStatus]))
    )
    const state = stage("look", project(), everything)

    expect(state.runSteps).toEqual([])
    expect(state.status).toBe("pending")
  })

  test("reads as pending before anything has run", () => {
    const states = stageStates(project(), null)

    expect(states.map((state) => state.status)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ])
  })
})

describe("a stage's status", () => {
  test("is running while any of its steps is", () => {
    // Footage owns scan, extract-audio and transcribe: two done, one going.
    const state = stage(
      "footage",
      project(),
      run({
        scan: "success",
        "extract-audio": "success",
        transcribe: "running",
      })
    )

    expect(state.status).toBe("running")
  })

  test("is only success once all of its steps are", () => {
    const partly = stage(
      "footage",
      project(),
      run({ scan: "success", "extract-audio": "success" })
    )
    const fully = stage(
      "footage",
      project(),
      run({
        scan: "success",
        "extract-audio": "success",
        transcribe: "success",
      })
    )

    expect(partly.status).toBe("pending")
    expect(fully.status).toBe("success")
  })

  test("reports a failure over work still in progress", () => {
    // One scene failing doesn't stop the fan-out, so both are true at once —
    // and the broken one is the one worth surfacing.
    const state = stage(
      "scenes",
      project(),
      run({ scenarios: "success", generate: "failed", review: "running" })
    )

    expect(state.status).toBe("failed")
  })

  test("flags the gate it is parked on", () => {
    const state = stage("cleanup", project(), run({ cleanup: "suspended" }))

    expect(state.needsYou).toBe(true)
    expect(state.status).toBe("suspended")
  })
})

describe("what a stage says when nothing is running", () => {
  test("summarizes what it holds", () => {
    const state = stage(
      "scenes",
      project({
        cleanupApprovedAt: "2026-08-02T10:00:00.000Z",
        scenes: [
          scene("scene_01", "approved"),
          scene("scene_02", "exported"),
          scene("scene_03", "ready"),
        ],
      }),
      null
    )

    expect(state.detail).toBe("2 of 3 approved · 1 exported")
  })

  test("prefers the live detail of a step that is working", () => {
    const live = run({ generate: "running" })
    const generate = live.steps.find((step) => step.id === "generate")!
    generate.detail = "7 of 12 scenes"

    const state = stage(
      "scenes",
      project({
        cleanupApprovedAt: "2026-08-02T10:00:00.000Z",
        scenes: [scene("scene_01", "ready")],
      }),
      live
    )

    expect(state.detail).toBe("7 of 12 scenes")
  })
})

describe("the timeline export stage", () => {
  test("says nothing until there are spans to build a timeline from", () => {
    expect(stage("timeline", project(), null).detail).toBeNull()
  })

  test("reports the silence cap and whether it's approved", () => {
    const notApproved = stage(
      "timeline",
      project({ spans: [{ start: 0, end: 1, action: "keep" }] as never }),
      null
    )
    const approved = stage(
      "timeline",
      project({
        spans: [{ start: 0, end: 1, action: "keep" }] as never,
        maxSilenceSec: 0.5,
        timelineApprovedAt: "2026-08-02T10:00:00.000Z",
      }),
      null
    )

    expect(notApproved.detail).toBe("0.3s silence cap · not yet approved")
    expect(approved.detail).toBe("0.5s silence cap · approved")
  })
})

describe("locking", () => {
  test("holds scenes shut until the timeline export is approved", () => {
    const gated = stage(
      "scenes",
      project({ cleanupApprovedAt: "2026-08-02T10:00:00.000Z" }),
      null
    )
    const open = stage(
      "scenes",
      project({
        cleanupApprovedAt: "2026-08-02T10:00:00.000Z",
        timelineApprovedAt: "2026-08-02T10:05:00.000Z",
      }),
      null
    )

    expect(gated.locked).toContain("approve the timeline export")
    expect(open.locked).toBeNull()
  })

  test("holds the timeline export shut until cleanup is approved", () => {
    const gated = stage("timeline", project(), null)
    const open = stage(
      "timeline",
      project({ cleanupApprovedAt: "2026-08-02T10:00:00.000Z" }),
      null
    )

    expect(gated.locked).not.toBeNull()
    expect(open.locked).toBeNull()
  })

  test("never locks the style guide, which is an input", () => {
    expect(stage("look", project(), null).locked).toBeNull()
  })

  test("opens cleanup as soon as there are spans to look at", () => {
    const empty = stage("cleanup", project(), null)
    const withSpans = stage(
      "cleanup",
      project({ spans: [{ start: 0, end: 1, action: "cut" }] as never }),
      null
    )

    expect(empty.locked).not.toBeNull()
    expect(withSpans.locked).toBeNull()
  })
})

describe("which stage the page opens on", () => {
  const approved = project({
    cleanupApprovedAt: "2026-08-02T10:00:00.000Z",
    timelineApprovedAt: "2026-08-02T10:05:00.000Z",
    spans: [{ start: 0, end: 1, action: "cut" }] as never,
    media: [{ path: "01.MP4" }] as never,
    scenes: [scene("scene_01", "ready")],
  })

  test("is whichever one is waiting on a human", () => {
    // Generate is still finishing while review has already suspended — the
    // gate wins, because the run will not move until it's dealt with.
    const current = run({ generate: "running", cleanup: "suspended" })
    const states = stageStates(approved, current)

    expect(focusStage(states, approved)).toBe("cleanup")
  })

  test("is the running one when nothing is waiting", () => {
    const current = run({ transcribe: "running" })
    const states = stageStates(approved, current)

    expect(focusStage(states, approved)).toBe("footage")
  })

  test("is the failed one when the run is over and something broke", () => {
    const current = run({ scan: "success", transcribe: "failed" })
    const states = stageStates(approved, current)

    expect(focusStage(states, approved)).toBe("footage")
  })

  test("falls back to the furthest stage that has something in it", () => {
    const states = stageStates(approved, null)

    expect(focusStage(states, approved)).toBe("scenes")
  })

  test("never lands on a locked stage", () => {
    // Scenes exist but the cleanup was reopened, so the scenes stage is shut.
    const reopened = project({
      spans: [{ start: 0, end: 1, action: "cut" }] as never,
      media: [{ path: "01.MP4" }] as never,
      scenes: [scene("scene_01", "ready")],
    })
    const states = stageStates(reopened, null)

    expect(focusStage(states, reopened)).toBe("cleanup")
  })

  test("starts on the footage of a project that has never run", () => {
    const fresh = project()
    const states = stageStates(fresh, null)

    expect(focusStage(states, fresh)).toBe("footage")
  })
})
