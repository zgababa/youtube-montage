/**
 * The one endpoint the pipeline UI talks to.
 *
 * Starting a run and resuming a suspended one are the same request with a
 * different body — `{ inputData }` versus `{ runId, step, resumeData }` — and
 * both stream back through the same connection. That's why the approvals in
 * idea.md §4.2 need no job registry or status endpoint: `run.resume()` picks up
 * a snapshot Mastra already persisted, and the response is just the rest of the
 * run.
 */

import { handleWorkflowStream } from "@mastra/ai-sdk"
import { createUIMessageStreamResponse } from "ai"

import { mastra } from "@/src/mastra"
import type { PipelineUIMessage } from "@/src/mastra/stream/contract"

// ffmpeg, Playwright and `fs` all live behind this route (idea.md §9).
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * A full run is transcription plus a dozen model calls plus a serialized
 * export. Minutes, not seconds — and the default request timeout would cut the
 * stream long before the workflow finished.
 */
export const maxDuration = 3600

export async function POST(request: Request) {
  const params = await request.json()

  const stream = await handleWorkflowStream<PipelineUIMessage>({
    mastra,
    workflowId: "brollWorkflow",
    params,
    // The app is typed against the AI SDK v6 line, so the handler has to emit
    // that contract rather than the v5 default.
    version: "v6",
    // Nothing here produces prose for the user to read — every meaningful
    // event is a typed `data-*` chunk.
    includeTextStreamParts: false,
  })

  return createUIMessageStreamResponse({ stream })
}
