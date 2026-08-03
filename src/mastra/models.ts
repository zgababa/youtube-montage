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
