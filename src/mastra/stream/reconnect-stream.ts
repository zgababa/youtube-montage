/**
 * The route's half of `reconnect.ts` — turns the pure chunk list into the
 * `ReadableStream` `createUIMessageStreamResponse` expects, the same contract
 * `workflowSnapshotToStream` returns for a live run (see `reconnect.ts` for
 * why that function itself isn't used here).
 */

import {
  workflowStateToPipelineChunks,
  type WorkflowStateForReconnect,
} from "./reconnect"

export function workflowStateToPipelineStream(
  state: WorkflowStateForReconnect
): ReadableStream {
  const chunks = workflowStateToPipelineChunks(state)
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}
