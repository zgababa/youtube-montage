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
}

export async function generateStructured<T extends z.ZodType>({
  agent,
  prompt,
  schema,
  label,
}: GenerateStructuredOptions<T>): Promise<z.infer<T>> {
  const first = await attempt(agent, prompt, schema)
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

  const second = await attempt(agent, repairPrompt, schema)
  if (second.ok) return second.value

  throw new Error(
    `${label}: model output failed schema validation twice. Last error: ${second.error}`
  )
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string }

async function attempt<T extends z.ZodType>(
  agent: Agent,
  prompt: string,
  schema: T
): Promise<Attempt<z.infer<T>>> {
  try {
    const response = await agent.generate(prompt, {
      structuredOutput: {
        schema,
        // 'auto' uses the provider's native structured output where it's
        // actually supported and falls back to prompt injection where it
        // isn't — which is the situation a gateway puts us in.
        jsonPromptInjection: "auto",
      },
    })

    const parsed = schema.safeParse(response.object)
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
