/**
 * Structured generation, with one repair attempt.
 *
 * Every agent here reaches Anthropic through OpenRouter, which speaks the
 * OpenAI-compatible `/chat/completions` shape. Native JSON-schema enforcement
 * doesn't always survive that translation, so a response can come back
 * *nearly* right — a field renamed, a number as a string, an extra wrapper
 * object.
 *
 * Rather than let a Zod error kill a run that's already spent real money on
 * transcription, the failure is handed back to the model with the exact
 * validation message. One retry catches essentially all of it; a second would
 * mostly be paying twice for the same wrong answer.
 */

import type { Agent } from "@mastra/core/agent"
import type { z } from "zod"

export interface GenerateStructuredOptions<T extends z.ZodType> {
  agent: Agent
  prompt: string
  schema: T
  /** Labels the error if both attempts fail. */
  label: string
  /**
   * Called with the object as it fills in, for steps that want to show work.
   *
   * These agents think for a long time — a 400-segment cleanup window is the
   * better part of a minute — and a progress bar that can only move between
   * whole passes says nothing about whether anything is happening. Partials are
   * the only signal available during a call.
   *
   * Never awaited: reporting must not backpressure generation, and a failure to
   * describe the work is not a reason to lose it.
   */
  onPartial?: (partial: Partial<z.infer<T>>) => void
}

export async function generateStructured<T extends z.ZodType>({
  agent,
  prompt,
  schema,
  label,
  onPartial,
}: GenerateStructuredOptions<T>): Promise<z.infer<T>> {
  const first = await attempt(agent, prompt, schema, onPartial)
  if (first.ok) return first.value

  const repairPrompt = [
    prompt,
    "",
    "Your previous response did not match the required schema.",
    "",
    `Validation error: ${first.error}`,
    "",
    "Return the corrected result. Output only the data — no commentary, no explanation of what changed.",
  ].join("\n")

  const second = await attempt(agent, repairPrompt, schema, onPartial)
  if (second.ok) return second.value

  throw new Error(
    `${label}: model output failed schema validation twice. Last error: ${second.error}`
  )
}

/**
 * The elements of a streaming array that are known to be finished.
 *
 * Partial JSON arrives left to right, so the last element in a partial is
 * always suspect — its final field may be half a string. Everything before it
 * is settled, because the parser only starts an element once the previous one
 * closed. Reporting the last one too would show a truncated `reason` as the
 * model's decision.
 *
 * `from` is how many the caller has already handled, so this returns only what
 * is newly safe to report.
 */
export function settled<T>(list: T[] | undefined, from: number): T[] {
  const items = list ?? []
  return items.slice(from, Math.max(from, items.length - 1))
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string }

async function attempt<T extends z.ZodType>(
  agent: Agent,
  prompt: string,
  schema: T,
  onPartial?: (partial: Partial<z.infer<T>>) => void
): Promise<Attempt<z.infer<T>>> {
  try {
    const stream = await agent.stream(prompt, {
      structuredOutput: {
        schema,
        // 'auto' uses the provider's native structured output where it's
        // actually supported and falls back to prompt injection where it
        // isn't — which is the situation a gateway puts us in.
        jsonPromptInjection: "auto",
      },
    })

    // Streamed rather than generated even with no observer, so there's one code
    // path to reason about. `stream.object` still resolves to the whole
    // validated result, so callers that ignore partials behave exactly as they
    // did when this called `generate`.
    if (onPartial) {
      for await (const partial of stream.objectStream) {
        onPartial(partial as Partial<z.infer<T>>)
      }
    }

    const parsed = schema.safeParse(await stream.object)
    if (parsed.success) return { ok: true, value: parsed.data }
    return { ok: false, error: formatIssues(parsed.error) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Compact enough to put back in a prompt without burning a thousand tokens. */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ")
}
