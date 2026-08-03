/**
 * Which model writes a scene.
 *
 * The scene agent's model is resolved per request rather than fixed at
 * construction, so a scene sent back at review can be written by something
 * else without a second agent existing. That resolution is the thing worth
 * testing: it costs no API call, and getting it wrong is silent — the
 * regeneration would simply run on the default and look like the model change
 * didn't help.
 */

import { describe, expect, test } from "bun:test"
import { RequestContext } from "@mastra/core/request-context"

import { sceneAgent, SCENE_MODEL_KEY } from "../src/mastra/agents/scene-agent"
import { modelLabel, SCENE_MODEL, SCENE_MODELS } from "../src/mastra/models"

/**
 * Untyped on purpose: `getModel` takes a `RequestContext<unknown>`, and the
 * generic is invariant, so the keyed flavour the pipeline builds doesn't fit
 * here. The agent reads the key the same way either way.
 */
function contextFor(model: string) {
  const context = new RequestContext()
  context.set(SCENE_MODEL_KEY, model)
  return context
}

describe("the scene agent's model", () => {
  test("falls back to the house default with no context", async () => {
    const model = await sceneAgent.getModel()

    expect(`openrouter/${model.modelId}`).toBe(SCENE_MODEL)
  })

  test("is whatever the request context names", async () => {
    const model = await sceneAgent.getModel({
      requestContext: contextFor("openrouter/anthropic/claude-opus-5"),
    })

    expect(model.modelId).toBe("anthropic/claude-opus-5")
  })

  test("resolves every model the selector offers", async () => {
    // A typo in the list is otherwise only discovered by a reviewer picking
    // that entry and watching the regeneration fail.
    for (const choice of SCENE_MODELS) {
      const model = await sceneAgent.getModel({
        requestContext: contextFor(choice.id),
      })

      expect(`${model.provider}/${model.modelId}`).toBe(choice.id)
    }
  })
})

describe("modelLabel", () => {
  test("names the models on the list", () => {
    expect(modelLabel(SCENE_MODEL)).toBe("Gemini 3.6 Flash")
  })

  test("falls back to the id for a model that has since been dropped", () => {
    // A scene generated months ago still has to say what wrote it.
    expect(modelLabel("openrouter/anthropic/claude-opus-4.1")).toBe(
      "anthropic/claude-opus-4.1"
    )
  })
})
