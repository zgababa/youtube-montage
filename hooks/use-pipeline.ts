"use client"

import * as React from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"

import { EMPTY_PIPELINE_STATE, reduceParts } from "@/lib/run-reducer"
import type { PipelineState } from "@/lib/run-reducer"
import type {
  PipelineAction,
  PipelineUIMessage,
} from "@/src/mastra/stream/contract"
import type { SceneDraft } from "@/lib/types"

/**
 * The live view of whichever single action is running.
 *
 * `useChat` for something that isn't a chat is deliberate. What it provides —
 * an append-and-reconcile message stream, typed data parts, and a transport
 * that survives a long-running response — is exactly what a stream of
 * progress events needs, and building it again would be building a worse
 * version of it.
 *
 * The stream is only ever a *liveness* channel. Everything it carries has
 * already been written to `project.json` by the action that emitted it, so
 * losing the connection — closing the tab, restarting the server — costs the
 * ticking progress bar and nothing else (idea.md §9). There is nothing to
 * reconnect to: every action here is a direct, one-shot call, not a workflow
 * run parked at a gate somewhere on the server.
 */
export interface PipelineOptions {
  /**
   * Fires when the response stream closes — finished or failed. The right
   * moment to re-read `project.json`, since the action wrote its results
   * there before returning.
   *
   * Must be stable: it's handed to `useChat`, which holds one chat instance
   * for the life of the component.
   */
  onSettled?: () => void
}

export function usePipeline(
  projectPath: string,
  options: PipelineOptions = {}
) {
  // Transient chunks never reach `message.parts`, so logs are accumulated here
  // from `onData` instead. Keyed by step, newest last.
  const [logs, setLogs] = React.useState<Record<string, string[]>>({})

  // Same reason, and the same shape of problem: scene documents arrive in
  // deltas, keyed by scene, and only matter while the action is in front of
  // you.
  const [drafts, setDrafts] = React.useState<Record<string, SceneDraft>>({})

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<PipelineUIMessage>({
        api: "/api/pipeline",
        prepareSendMessagesRequest: ({ messages }) => {
          const action = messages.at(-1)?.metadata
          if (!action)
            throw new Error("Pipeline message sent without an action")
          return { body: action }
        },
      }),
    []
  )

  const { onSettled } = options

  const { messages, sendMessage, status, error, stop } =
    useChat<PipelineUIMessage>({
      transport,
      onFinish: onSettled,
      onData: (part) => {
        if (part.type === "data-log") {
          const { step, line } = part.data
          setLogs((current) => ({
            ...current,
            // Bounded: a long transcription can emit thousands of lines, and
            // the collapsible log only ever shows the tail.
            [step]: [...(current[step] ?? []), line].slice(-200),
          }))
          return
        }

        if (part.type === "data-scene-draft") {
          const { id, delta, attempt } = part.data
          setDrafts((current) => {
            // A repair is a different document. Keeping the attempt number in
            // the draft is what lets the frame know to start a new one rather
            // than append the second attempt to the first.
            const previous = current[id]
            const same = previous?.attempt === attempt
            return {
              ...current,
              [id]: {
                attempt,
                html: same ? previous.html + delta : delta,
              },
            }
          })
        }
      },
    })

  const streaming = status === "streaming" || status === "submitted"

  const state: PipelineState = React.useMemo(
    () => reduceParts(messages, { logs, streaming }),
    [messages, logs, streaming]
  )

  /**
   * Every action is `{ kind, projectPath, ...args }` — `PipelineAction`
   * (`src/mastra/stream/contract.ts`) is the one place that catalogues them,
   * validated again server-side against the same schema. A caller building
   * this object gets the same exhaustiveness checking a dedicated method per
   * action would have given, without a wrapper per action to keep in sync.
   */
  const send = React.useCallback(
    (action: PipelineAction) => {
      // The text is inert — the route reads the body, which
      // `prepareSendMessagesRequest` builds from the metadata. It exists
      // because `sendMessage` wants a message.
      sendMessage({ text: action.kind, metadata: action })
    },
    [sendMessage]
  )

  return {
    ...(messages.length === 0 ? EMPTY_PIPELINE_STATE : state),
    logs,
    drafts,
    streaming,
    error,
    stop,
    projectPath,
    send,
  }
}
