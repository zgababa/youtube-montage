/**
 * Model ids, in Mastra's model-router `provider/model` form.
 *
 * Everything model-related goes through the OpenRouter gateway so one
 * `OPENROUTER_API_KEY` covers the pipeline, but the models behind it are
 * Anthropic's. Note the doubled path: OpenRouter is itself a gateway, so the
 * upstream provider stays in the id — `openrouter/anthropic/claude-opus-5`, not
 * `openrouter/claude-opus-5`.
 *
 * Transcription is the exception and doesn't appear here: it calls OpenAI
 * directly, because word-level timestamps aren't reachable through a
 * chat-completions gateway. See `lib/whisper.ts`.
 */

/** Writes 1920×1080 HTML under hard constraints — the hardest job here. */
export const SCENE_MODEL = "openrouter/anthropic/claude-sonnet-5"

/**
 * Reads the whole transcript and decides what to cut. Sees the most tokens of
 * any agent, and the task is judgement over long context rather than
 * generation, so it gets the fast variant.
 */
export const CLEANUP_MODEL = "openrouter/anthropic/claude-sonnet-5"

/** Decides where b-roll helps. Needs to hold the whole script in view. */
export const SCENARIO_MODEL = "openrouter/anthropic/claude-sonnet-5"

/** One palette/type/motion guide per project. Short, one-shot. */
export const STYLE_MODEL = "openrouter/anthropic/claude-sonnet-5"

/** YouTube and Twitter copy from the approved script. */
export const COPY_MODEL = "openrouter/anthropic/claude-sonnet-5"

/**
 * Transcription. Deliberately not a router id — `openai` here means the OpenAI
 * SDK, called directly.
 *
 * `whisper-1` is not a legacy holdover: it is the only OpenAI model that still
 * supports `timestamp_granularities: ["word"]`. The gpt-4o-transcribe family
 * dropped granular timestamps, and word timing is what every span decision and
 * scene placement downstream is anchored to (idea.md §3).
 */
export const TRANSCRIBE_MODEL = "whisper-1"
