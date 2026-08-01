import { describe, expect, test } from "bun:test"
import { z } from "zod"

import type { Agent } from "@mastra/core/agent"

import { generateStructured, settled } from "../src/mastra/lib/structured"

const CutsSchema = z.object({
  cuts: z.array(z.object({ from: z.number(), reason: z.string() })),
})

type Cuts = z.infer<typeof CutsSchema>

/**
 * Stands in for the agent's streaming interface: a sequence of progressively
 * complete partials, then the finished object. That's the shape
 * `agent.stream(..., { structuredOutput })` returns, and the only part of the
 * agent this module touches.
 */
function fakeAgent(responses: { partials: unknown[]; final: unknown }[]) {
  let call = 0
  const prompts: string[] = []

  const agent = {
    stream(prompt: string) {
      const response = responses[Math.min(call, responses.length - 1)]
      call += 1
      prompts.push(prompt)

      return Promise.resolve({
        objectStream: new ReadableStream({
          start(controller) {
            for (const partial of response.partials) controller.enqueue(partial)
            controller.close()
          },
        }),
        object: Promise.resolve(response.final),
      })
    },
  }

  return { agent: agent as unknown as Agent, prompts, calls: () => call }
}

describe("settled", () => {
  /**
   * Partial JSON arrives left to right, so the last element of a partial array
   * may be half-written — a `reason` cut off mid-sentence. Reporting it would
   * show a truncated string as the model's decision.
   */
  test("holds back the element still arriving", () => {
    expect(settled([{ n: 1 }, { n: 2 }, { n: 3 }], 0)).toEqual([
      { n: 1 },
      { n: 2 },
    ])
  })

  test("returns only what the caller hasn't seen", () => {
    expect(settled([{ n: 1 }, { n: 2 }, { n: 3 }], 2)).toEqual([])
    expect(settled([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], 2)).toEqual([
      { n: 3 },
    ])
  })

  test("a single element is never settled on its own", () => {
    // Nothing has closed it yet, so it could still be growing.
    expect(settled([{ n: 1 }], 0)).toEqual([])
  })

  test("handles the array not having started", () => {
    expect(settled(undefined, 0)).toEqual([])
    expect(settled([], 0)).toEqual([])
  })

  test("never returns a negative slice when already ahead", () => {
    expect(settled([{ n: 1 }], 5)).toEqual([])
  })
})

describe("generateStructured", () => {
  test("returns the validated object", async () => {
    const { agent } = fakeAgent([
      { partials: [], final: { cuts: [{ from: 1, reason: "filler" }] } },
    ])

    const result = await generateStructured({
      agent,
      prompt: "go",
      schema: CutsSchema,
      label: "test",
    })

    expect(result.cuts).toHaveLength(1)
  })

  test("reports partials as the object fills in", async () => {
    const { agent } = fakeAgent([
      {
        partials: [
          { cuts: [{ from: 1 }] },
          { cuts: [{ from: 1, reason: "filler" }] },
          { cuts: [{ from: 1, reason: "filler" }, { from: 4 }] },
        ],
        final: {
          cuts: [
            { from: 1, reason: "filler" },
            { from: 4, reason: "repetition" },
          ],
        },
      },
    ])

    const seen: Partial<Cuts>[] = []
    await generateStructured({
      agent,
      prompt: "go",
      schema: CutsSchema,
      label: "test",
      onPartial: (partial) => seen.push(partial),
    })

    expect(seen).toHaveLength(3)
    expect(seen[2].cuts).toHaveLength(2)
  })

  /**
   * The step announces `settled(partial.cuts, n)` as it goes and flushes the
   * rest afterwards. Together those must cover every cut exactly once — a
   * dropped one is a decision the user never sees, a doubled one is a cut that
   * looks like two.
   */
  test("streamed and flushed announcements cover each cut once", async () => {
    const final = {
      cuts: [
        { from: 1, reason: "a" },
        { from: 4, reason: "b" },
        { from: 9, reason: "c" },
      ],
    }
    const { agent } = fakeAgent([
      {
        partials: [
          { cuts: [{ from: 1 }] },
          { cuts: [{ from: 1, reason: "a" }, { from: 4 }] },
          {
            cuts: [
              { from: 1, reason: "a" },
              { from: 4, reason: "b" },
            ],
          },
        ],
        final,
      },
    ])

    const announced: number[] = []
    let count = 0

    const result = await generateStructured({
      agent,
      prompt: "go",
      schema: CutsSchema,
      label: "test",
      onPartial: (partial) => {
        for (const cut of settled(partial.cuts, count)) {
          announced.push(cut.from!)
          count += 1
        }
      },
    })
    for (let i = count; i < result.cuts.length; i += 1) {
      announced.push(result.cuts[i].from)
    }

    expect(announced).toEqual([1, 4, 9])
  })

  test("does not consume the stream when nobody is watching", async () => {
    // The partials here are deliberately malformed. Reaching them would mean
    // the observer-free path is paying to parse output it can't use.
    const { agent } = fakeAgent([
      {
        partials: [null, undefined],
        final: { cuts: [{ from: 1, reason: "filler" }] },
      },
    ])

    const result = await generateStructured({
      agent,
      prompt: "go",
      schema: CutsSchema,
      label: "test",
    })

    expect(result.cuts).toHaveLength(1)
  })

  test("repairs a schema violation and keeps the observer", async () => {
    const { agent, prompts, calls } = fakeAgent([
      { partials: [], final: { cuts: "not an array" } },
      { partials: [], final: { cuts: [{ from: 2, reason: "false start" }] } },
    ])

    const seen: Partial<Cuts>[] = []
    const result = await generateStructured({
      agent,
      prompt: "go",
      schema: CutsSchema,
      label: "test",
      onPartial: (partial) => seen.push(partial),
    })

    expect(calls()).toBe(2)
    expect(result.cuts[0].reason).toBe("false start")
    // The repair prompt carries the actual validation message back.
    expect(prompts[1]).toContain("did not match the required schema")
  })

  test("gives up after the second failure, naming the step", async () => {
    const { agent } = fakeAgent([{ partials: [], final: { cuts: 42 } }])

    await expect(
      generateStructured({
        agent,
        prompt: "go",
        schema: CutsSchema,
        label: "cleanup",
      })
    ).rejects.toThrow(/cleanup/)
  })
})
