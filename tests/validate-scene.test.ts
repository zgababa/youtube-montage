import { afterAll, describe, expect, test } from "bun:test"

import { closeBrowser } from "../src/mastra/lib/render"
import { staticProblems, validateScene } from "../src/mastra/lib/validate-scene"

afterAll(async () => {
  await closeBrowser()
})

/** A well-behaved scene: CSS only, finite, transparent, self-contained. */
function scene({
  durationMs = 2000,
  delayMs = 0,
  extraHead = "",
  extraBody = "",
} = {}) {
  return `<!doctype html>
<html>
<head>
<style>
  .card {
    font-family: ui-sans-serif, system-ui, sans-serif;
    color: #E8E8ED;
    opacity: 0;
    animation: rise ${durationMs}ms cubic-bezier(.16,1,.3,1) ${delayMs}ms both;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(24px) scale(.98); }
    to   { opacity: 1; transform: none; }
  }
</style>
${extraHead}
</head>
<body>
  <div class="card">the agent picks up the job from the queue</div>
${extraBody}
</body>
</html>`
}

describe("staticProblems", () => {
  test("passes a clean scene", () => {
    expect(staticProblems(scene())).toEqual([])
  })

  const banned: [string, string][] = [
    ["setTimeout", "<script>setTimeout(() => {}, 100)</script>"],
    ["setInterval", "<script>setInterval(() => {}, 100)</script>"],
    [
      "requestAnimationFrame",
      "<script>requestAnimationFrame(() => {})</script>",
    ],
    ["Date.now", "<script>const t = Date.now()</script>"],
    ["canvas", "<canvas width='100' height='100'></canvas>"],
    ["video", "<video src='clip.mp4'></video>"],
    ["remote script", "<script src='https://cdn.example.com/x.js'></script>"],
  ]

  for (const [name, markup] of banned) {
    test(`rejects ${name}`, () => {
      expect(
        staticProblems(scene({ extraBody: markup })).length
      ).toBeGreaterThan(0)
    })
  }

  test("rejects @import and infinite animations", () => {
    expect(
      staticProblems(scene({ extraHead: "<style>@import url(x.css);</style>" }))
        .length
    ).toBeGreaterThan(0)
    expect(
      staticProblems(
        scene({
          extraHead: "<style>.x{animation-iteration-count:infinite}</style>",
        })
      ).length
    ).toBeGreaterThan(0)
  })

  test("rejects an opaque background but allows a transparent one", () => {
    expect(
      staticProblems(
        scene({ extraHead: "<style>body{background:#000}</style>" })
      ).length
    ).toBeGreaterThan(0)
    expect(
      staticProblems(
        scene({ extraHead: "<style>body{background:transparent}</style>" })
      )
    ).toEqual([])
  })
})

describe("validateScene", () => {
  test("accepts a scene that fits its window", async () => {
    const result = await validateScene(scene({ durationMs: 2000 }), 7)

    expect(result.ok).toBe(true)
    expect(result.durationSec).toBeCloseTo(2, 1)
  }, 60_000)

  /**
   * idea.md §5 names this as "the single most likely everyday annoyance": a
   * scene animating far past the gap it fills. The whole point of measuring in
   * a real browser is that it's caught here rather than in the edit.
   */
  test("rejects a scene that overruns its window", async () => {
    const result = await validateScene(scene({ durationMs: 15_000 }), 7)

    expect(result.ok).toBe(false)
    expect(result.durationSec).toBeCloseTo(15, 1)
    expect(result.problems.join(" ")).toContain("15.0s")
    expect(result.problems.join(" ")).toContain("7.0s")
  }, 60_000)

  test("counts delay towards the total, not just duration", async () => {
    // 2s of motion that starts 9s in still overruns a 7s gap.
    const result = await validateScene(
      scene({ durationMs: 2000, delayMs: 9000 }),
      7
    )

    expect(result.ok).toBe(false)
    expect(result.durationSec).toBeCloseTo(11, 1)
  }, 60_000)

  test("rejects a scene with nothing animating", async () => {
    const still = `<!doctype html><html><body><div>static</div></body></html>`
    const result = await validateScene(still, 7)

    expect(result.ok).toBe(false)
    expect(result.problems.join(" ")).toContain("still image")
  }, 60_000)

  test("skips the browser when the source is already disqualified", async () => {
    const result = await validateScene(
      scene({ extraBody: "<script>setInterval(()=>{},16)</script>" }),
      7
    )

    expect(result.ok).toBe(false)
    expect(result.durationSec).toBe(0)
  }, 60_000)
})
