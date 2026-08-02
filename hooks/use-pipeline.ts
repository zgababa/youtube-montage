"use client"

import * as React from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"

import { EMPTY_PIPELINE_STATE, reduceParts } from "@/lib/run-reducer"
import type { PipelineState } from "@/lib/run-reducer"
import type {
  PipelineAction,
  PipelineUIMessage,
  SceneDecision,
} from "@/src/mastra/stream/contract"
import type { SceneDraft, Span } from "@/lib/types"

/**
 * The live view of a workflow run.
 *
 * `useChat` for something that isn't a chat is deliberate. What it provides —
 * an append-and-reconcile message stream, typed data parts, and a transport
 * that survives a long-running response — is exactly what a workflow with
 * fourteen kinds of progress event needs, and building it again would be
 * building a worse version of it.
 *
 * The stream is only ever a *liveness* channel. Everything it carries has
 * already been written to `project.json` by the step that emitted it, so
 * losing the connection — closing the tab, restarting the server — costs the
 * ticking progress bar and nothing else (idea.md §9).
 */
export interface PipelineOptions {
  /**
   * Fires when the response stream closes — whether the run finished, hit a
   * gate, or failed. The right moment to re-read `project.json`, since every
   * step wrote its results there before returning.
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
  // deltas, keyed by scene, and only matter while the run is in front of you.
  const [drafts, setDrafts] = React.useState<Record<string, SceneDraft>>({})

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport<PipelineUIMessage>({
        api: "/api/pipeline",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: toBody(messages.at(-1)?.metadata),
        }),
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

  const send = React.useCallback(
    (action: PipelineAction) => {
      // The text is inert — the workflow route reads the body, which
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

    start: React.useCallback(
      () => send({ kind: "start", projectPath }),
      [send, projectPath]
    ),

    approveCleanup: React.useCallback(
      (runId: string, spans: Span[]) =>
        send({ kind: "approve-cleanup", runId, spans }),
      [send]
    ),

    submitReview: React.useCallback(
      (runId: string, decisions: SceneDecision[], done: boolean) =>
        send({ kind: "review-scenes", runId, decisions, done }),
      [send]
    ),
  }
}

/**
 * Action to request body.
 *
 * Exhaustive on purpose — the `never` fallthrough means adding a case to
 * `PipelineAction` without handling it here is a type error rather than a
 * request that silently starts a fresh run.
 */
function toBody(action: PipelineAction | undefined) {
  switch (action?.kind) {
    case "start":
      return { inputData: { projectPath: action.projectPath } }

    case "approve-cleanup":
      return {
        runId: action.runId,
        step: "cleanup",
        resumeData: { approved: true, spans: action.spans },
      }

    case "review-scenes":
      return {
        runId: action.runId,
        step: "review",
        resumeData: { decisions: action.decisions, done: action.done },
      }

    default:
      throw new Error("Pipeline message sent without an action")
  }
}
