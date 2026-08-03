/**
 * Model ids, in Mastra's model-router `provider/model` form.
 *
 * Everything model-related goes through the OpenRouter gateway so one
 * `OPENROUTER_API_KEY` covers the pipeline, but the models behind it are
 * Anthropic's. Note the doubled path: OpenRouter is itself a gateway, so the
 * upstream provider stays in the id — `openrouter/anthropic/claude-opus-5`, not
 * `openrouter/claude-opus-5`.
 *
 * Transcription is the exception: it calls AssemblyAI directly, because
 * word-level timestamps aren't reachable through a chat-completions gateway.
 * See `lib/stt.ts`.
 */

/** Writes 1920×1080 HTML under hard constraints — the hardest job here. */
export const SCENE_MODEL = "openrouter/google/gemini-3.6-flash"

export interface ModelChoice {
  id: string
  /** What the selector shows. The router id is too long to read at a glance. */
  label: string
  /** Why you would reach for this one instead of the default. */
  note: string
}

/**
 * What a scene can be regenerated with.
 *
 * Scene generation is the one place a model choice is worth exposing, because
 * it's the one place the output is judged by eye and thrown back. The rest of
 * the pipeline produces text nobody re-rolls a model over.
 *
 * The list is short on purpose. OpenRouter serves several hundred models and a
 * dropdown of several hundred is not a choice, it's a search problem — these
 * are the ones that can hold a 1920×1080 layout in their head and still obey a
 * constraint list. Anything here has to be reachable through the same
 * `OPENROUTER_API_KEY`, so adding one is a line in this array and nothing else.
 */
export const SCENE_MODELS: ModelChoice[] = [
  {
    id: SCENE_MODEL,
    label: "Gemini 3.6 Flash",
    note: "The default. Fast and cheap enough to re-roll freely.",
  },
  {
    id: "openrouter/anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    note: "Stronger at composition and at reading the constraint list.",
  },
  {
    id: "openrouter/anthropic/claude-opus-5",
    label: "Claude Opus 5",
    note: "Slowest and best. Worth it for a scene that keeps coming back wrong.",
  },
  {
    id: "openrouter/openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    note: "A different house style — useful when the others keep making the same mistake.",
  },
  {
    id: "openrouter/x-ai/grok-4.20",
    label: "Grok 4.20",
    note: "Looser and more literal. Occasionally finds a composition the others don't.",
  },
]

/**
 * The selector's label for a stored id.
 *
 * Falls back to the id itself rather than to "Unknown": a project generated
 * before a model was dropped from the list above still ought to say what wrote
 * it.
 */
export function modelLabel(id: string): string {
  return (
    SCENE_MODELS.find((model) => model.id === id)?.label ??
    id.split("/").slice(1).join("/")
  )
}

/**
 * Reads the whole transcript and decides what to cut. Sees the most tokens of
 * any agent, and the task is judgement over long context rather than
 * generation, so it gets the fast variant.
 */
export const CLEANUP_MODEL = "openrouter/openai/gpt-5.6-terra"

/** Decides where b-roll helps. Needs to hold the whole script in view. */
export const SCENARIO_MODEL = "openrouter/anthropic/claude-sonnet-5"

/** YouTube and Twitter copy from the approved script. */
export const COPY_MODEL = "openrouter/openai/gpt-5.6-terra"

/**
 * Transcription. Deliberately not a router id — these are AssemblyAI model
 * names, passed to the AssemblyAI SDK.
 *
 * `speech_models` is an ordered *fallback* list, not parallel execution: the
 * first entry is tried and the next is used only if it can't serve the request.
 * `universal-3-5-pro` is the current flagship and covers 18 languages;
 * `universal-2` behind it covers 99, so a recording in something outside the
 * first model's range still transcribes rather than failing.
 *
 * Word-level timings come back on `words[]` by default — no flag to set, which
 * is why this isn't the constrained choice it was under OpenAI.
 */
export const TRANSCRIBE_MODELS = ["universal-3-5-pro", "universal-2"]
