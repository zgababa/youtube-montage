"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"

import { applyPatch } from "@/lib/run-reducer"
import { reveal, saveProject } from "@/lib/client-api"
import { sceneCounts, withDecisions } from "@/lib/project"
import { focusStage, stageStates, type StageId } from "@/lib/stages"
import type {
  MediaFile,
  Project,
  Span,
  StyleGuide,
  TranscriptionHints,
} from "@/lib/types"
import type { SceneDecision } from "@/src/mastra/stream/contract"
import { usePipeline } from "@/hooks/use-pipeline"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/toast"
import { CleanupReview } from "@/components/project/cleanup-review"
import { CopyReview } from "@/components/project/copy-review"
import { MediaSettings } from "@/components/project/media-settings"
import { ProjectHeader } from "@/components/project/project-header"
import { RunStrip } from "@/components/project/run-strip"
import { SceneList } from "@/components/project/scene-list"
import { ShotlistCard } from "@/components/project/shotlist-card"
import { Stage } from "@/components/project/stage"
import { StyleGuideEditor } from "@/components/project/style-guide-editor"
import { TranscriptionHintsEditor } from "@/components/project/transcription-hints"

/**
 * Holds the project while it's being reviewed.
 *
 * Three sources feed what's on screen, in order of precedence:
 *
 *   1. `project` — read from `project.json` on the server. The baseline, and
 *      everything the pipeline has ever produced.
 *   2. the live run's patch — steps emitting results as they land.
 *   3. local edits — span toggles and scene decisions the user has made but
 *      not submitted yet.
 *
 * The two approval gates are `run.resume()` calls, not application state
 * (idea.md §4.2), so what's on screen when the user clicks Approve is what the
 * workflow continues with.
 *
 * The page itself is a list of stages (`lib/stages.ts`) rather than a progress
 * panel above a row of tabs. Each stage owns both a run of pipeline steps and
 * the UI for what they produce, so watching a phase and acting on it are the
 * same place, and the page opens on whichever one is asking for something.
 */
export function ProjectWorkspace({
  project: fromDisk,
  activeRunId = null,
}: {
  project: Project
  /** A run suspended at a gate for this project, if any (issue #3). */
  activeRunId?: string | null
}) {
  const router = useRouter()

  /** Edits made since the last server read. */
  const [local, setLocal] = React.useState<Partial<Project>>({})

  // The stream closing means every step that ran has already written to
  // `project.json`. Re-reading makes the server authoritative again and
  // retires the local overlay. Memoized because `useChat` keeps one instance.
  const onSettled = React.useCallback(() => {
    setLocal({})
    router.refresh()
  }, [router])

  const pipeline = usePipeline(fromDisk.path, { onSettled, activeRunId })

  /**
   * Decisions are collected locally and submitted together.
   *
   * One resume per click would be wrong: each `run.resume()` restarts the step,
   * so approving twelve scenes individually would be twelve round trips through
   * the gate.
   */
  const [decisions, setDecisions] = React.useState<
    Record<string, SceneDecision>
  >({})

  /**
   * Disk, then local edits, then the live run, then this round's decisions.
   *
   * The run wins over local edits on purpose. A span the user toggled is only
   * theirs until the workflow confirms what it actually did with it, and the
   * confirmation is the thing worth showing. It also means local edits retire
   * themselves as the run reports, with nothing to clear.
   *
   * Scene decisions are the exception, and have to come last. The run's patch
   * carries the whole scenes array, so anything merged before it is replaced by
   * those scenes on the next render — which is exactly what made Approve and
   * Reject look like dead buttons.
   */
  const project = React.useMemo(
    () =>
      withDecisions(
        applyPatch(applyPatch(fromDisk, local), pipeline.patch),
        decisions
      ),
    [fromDisk, local, pipeline.patch, decisions]
  )

  function patch(next: Partial<Project>) {
    setLocal((current) => ({ ...current, ...next }))
  }

  /**
   * Settings the pipeline reads but doesn't produce: media roles and sync, fps,
   * style guide.
   *
   * These have to reach `project.json`, not just React state — the steps that
   * consume them read the file on the server, so a change held only on screen
   * was never actually applied. Shown immediately and written behind it; on a
   * write failure the local overlay is dropped so the UI stops claiming a
   * setting that isn't saved.
   */
  function persist(next: Partial<Project>, title: string, description: string) {
    patch(next)
    saveProject(project.id, next)
      .then(() => {
        toast.add({ title, description })
        router.refresh()
      })
      .catch((error: Error) => {
        setLocal((current) => {
          const rolledBack = { ...current }
          for (const key of Object.keys(next)) {
            delete rolledBack[key as keyof Project]
          }
          return rolledBack
        })
        toast.add({ title: "Couldn't save", description: error.message })
      })
  }

  /* ---------------------------------------------------------------------- */
  /* Which stage is showing                                                  */
  /* ---------------------------------------------------------------------- */

  const stages = React.useMemo(
    () => stageStates(project, pipeline.run),
    [project, pipeline.run]
  )

  /**
   * `undefined` means nobody has chosen — follow the run. Anything else is the
   * user's choice, including `null` for "I closed them all".
   */
  const [picked, setPicked] = React.useState<StageId | null | undefined>(
    undefined
  )

  const gated = stages.find((stage) => stage.needsYou)?.id ?? null

  /**
   * A gate opening steals focus, once.
   *
   * It's the only interruption worth overriding a deliberate choice for — the
   * run has stopped and will not continue until this screen is dealt with. It
   * sets the pick rather than winning the comparison below, so the user can
   * still navigate away afterwards.
   *
   * Adjusted during render against the gate it last saw, not in an effect: the
   * open stage is derived from React state, and syncing derived state in an
   * effect renders the wrong stage first and then corrects it.
   */
  const [seenGate, setSeenGate] = React.useState(gated)
  if (seenGate !== gated) {
    setSeenGate(gated)
    if (gated) setPicked(gated)
  }

  const open = picked === undefined ? focusStage(stages, project) : picked

  function jump(id: StageId) {
    setPicked(id)
    // After the open state has been applied, or the stage below it is still
    // the height it was when collapsed.
    requestAnimationFrame(() =>
      document
        .getElementById(`stage-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
    )
  }

  /* ---------------------------------------------------------------------- */
  /* Gate 1 — cleanup                                                        */
  /* ---------------------------------------------------------------------- */

  function toggleSpan(index: number) {
    patch({
      spans: project.spans.map((span, i): Span =>
        i === index
          ? { ...span, action: span.action === "cut" ? "keep" : "cut" }
          : span
      ),
    })
  }

  function approveCleanup() {
    if (!pipeline.run) {
      toast.add({
        title: "No run to approve",
        description:
          "Start a run first — approval resumes a suspended workflow.",
      })
      return
    }
    // The spans on screen, not the ones the agent proposed. Every toggle the
    // user made is part of what gets approved.
    pipeline.approveCleanup(pipeline.run.id, project.spans)
    toast.add({
      title: "Cleanup approved",
      description:
        "Run resumed — the scenario agent reads the approved script.",
    })
  }

  function reopenCleanup() {
    patch({ cleanupApprovedAt: null })
  }

  /* ---------------------------------------------------------------------- */
  /* Gate 2 — scenes                                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * One entry per scene the user has touched. The card's status comes from
   * here until the review is submitted, so a decision is a single write.
   */
  function decide(decision: SceneDecision) {
    setDecisions((current) => ({ ...current, [decision.id]: decision }))
  }

  function approveScene(id: string) {
    decide({ id, action: "approve" })
  }

  function rejectScene(id: string) {
    decide({ id, action: "reject" })
  }

  function regenerateScene(id: string, note: string, model: string) {
    decide({ id, action: "regenerate", note: note || undefined, model })
  }

  /** Sends everything decided so far and lets the run continue to export. */
  function submitReview(done: boolean) {
    if (!pipeline.run) {
      toast.add({
        title: "No run to resume",
        description: "Scene review resumes a suspended workflow.",
      })
      return
    }
    const pending = Object.values(decisions)
    pipeline.submitReview(pipeline.run.id, pending, done)
    setDecisions({})
    toast.add({
      title: done ? "Review submitted" : "Regenerating",
      description: done
        ? "Approved scenes export next — serialized, one at a time."
        : `${pending.length} scene${pending.length === 1 ? "" : "s"} sent back.`,
    })
  }

  function saveStyleGuide(styleGuide: StyleGuide) {
    persist(
      { styleGuide },
      "Style guide saved",
      "Applies to the next scenes generated."
    )
  }

  function saveHints(transcriptionHints: TranscriptionHints) {
    persist(
      { transcriptionHints },
      "Transcription hints saved",
      transcriptionHints.keyterms.length > 0
        ? `${transcriptionHints.keyterms.length} terms will be preferred.`
        : "Applied the next time transcription runs."
    )
  }

  function saveMedia(media: MediaFile[]) {
    const sources = media.filter((file) => file.hasAudio && file.transcribe)
    persist(
      { media },
      "Media settings saved",
      sources.length === 1
        ? `${sources[0].path} is the transcription source.`
        : `${sources.length} files will be transcribed.`
    )
  }

  const counts = sceneCounts(project.scenes)

  /**
   * More than one file feeding the transcriber, before anything has been
   * transcribed.
   *
   * Legitimate when the files are different footage, wrong when they're two
   * recordings of the same talk — and only the user knows which. Scan pairs
   * them automatically when it's unambiguous, so reaching here means it wasn't.
   */
  const needsMediaAttention =
    project.transcript.words.length === 0 &&
    project.media.filter((file) => file.hasAudio && file.transcribe).length > 1

  const decided = Object.values(decisions)
  const regenerating = decided.filter(
    (decision) => decision.action === "regenerate"
  ).length
  /**
   * Either there's something new to say, or there are approved scenes that
   * haven't been rendered yet — and the run isn't already working.
   *
   * The streaming half is load-bearing, not politeness. Every submit is a
   * `run.resume()`, and a second one while the first is still going runs the
   * export step twice over the same scenes; the two passes then delete each
   * other's frames and every scene comes back failed.
   */
  const canSubmitReview =
    !pipeline.streaming &&
    (decided.length > 0 || counts.approved > counts.exported)

  const body: Record<StageId, React.ReactNode> = {
    footage: (
      <>
        {needsMediaAttention ? (
          <Alert>
            <AlertTitle>Two files are set to be transcribed</AlertTitle>
            <AlertDescription>
              If they&rsquo;re two recordings of the same talk, transcribing
              both puts it in the script twice. Pick one and tell it which clip
              it belongs to.
            </AlertDescription>
          </Alert>
        ) : null}
        <MediaSettings media={project.media} onSave={saveMedia} />
        <Separator />
        <TranscriptionHintsEditor
          hints={project.transcriptionHints}
          locked={project.transcript.words.length > 0}
          onSave={saveHints}
        />
      </>
    ),

    cleanup: (
      <CleanupReview
        project={project}
        onToggleSpan={toggleSpan}
        onReopen={reopenCleanup}
      />
    ),

    look: (
      <StyleGuideEditor
        styleGuide={project.styleGuide}
        onSave={saveStyleGuide}
      />
    ),

    scenes: (
      <SceneList
        project={project}
        drafts={pipeline.drafts}
        onApprove={approveScene}
        onReject={rejectScene}
        onRegenerate={regenerateScene}
      />
    ),

    deliverables: (
      <>
        <CopyReview copy={project.copy} />
        <Separator />
        <ShotlistCard project={project} />
      </>
    ),
  }

  /** The one thing each stage is for, hoisted into its header. */
  const action: Partial<Record<StageId, React.ReactNode>> = {
    cleanup: (
      <Button
        size="sm"
        onClick={approveCleanup}
        disabled={project.cleanupApprovedAt !== null || pipeline.streaming}
      >
        <HugeiconsIcon
          icon={Tick02Icon}
          strokeWidth={2}
          data-icon="inline-start"
        />
        {project.cleanupApprovedAt !== null ? "Approved" : "Approve cleanup"}
      </Button>
    ),

    scenes: (
      <Button
        size="sm"
        onClick={() => submitReview(regenerating === 0)}
        disabled={!canSubmitReview}
      >
        {regenerating > 0
          ? `Send ${regenerating} back`
          : `Submit review${decided.length > 0 ? ` (${decided.length})` : ""}`}
      </Button>
    ),
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
      <ProjectHeader
        project={project}
        run={pipeline.run}
        onFpsChange={(fps) =>
          persist(
            { fps },
            "Frame rate saved",
            `Scenes export at ${fps} fps — match your timeline or the overlay judders.`
          )
        }
        onRun={() => {
          pipeline.start()
          toast.add({
            title: "Run started",
            description: "Progress streams in as each step reports.",
          })
        }}
        onReveal={() => {
          reveal(project.path).catch((error: Error) =>
            toast.add({ title: "Couldn't reveal", description: error.message })
          )
        }}
      />

      <RunStrip
        run={pipeline.run}
        stages={stages}
        onCancel={pipeline.stop}
        onJump={jump}
      />

      <div className="flex flex-col gap-3">
        {stages.map((stage) => (
          <Stage
            key={stage.id}
            stage={stage}
            open={open === stage.id}
            onOpenChange={(next) => setPicked(next ? stage.id : null)}
            action={action[stage.id]}
          >
            {body[stage.id]}
          </Stage>
        ))}
      </div>
    </main>
  )
}
