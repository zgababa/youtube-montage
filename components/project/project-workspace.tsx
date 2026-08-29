"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"

import { applyPatch } from "@/lib/run-reducer"
import { resolvePlanReviewDecisions } from "@/src/mastra/lib/editing-plan"
import {
  reveal,
  saveProject,
  updateTimeline as updateTimelineRequest,
} from "@/lib/client-api"
import { sceneCounts, withDecisions } from "@/lib/project"
import { focusStage, stageStates, type StageId } from "@/lib/stages"
import type {
  EditingDocument,
  MediaFile,
  Project,
  Span,
  StyleGuide,
  TranscriptionHints,
} from "@/lib/types"
import type {
  PlanElementDecision,
  PlanSectionDecision,
  SceneDecision,
} from "@/src/mastra/stream/contract"
import { usePipeline } from "@/hooks/use-pipeline"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/toast"
import { CleanupReview } from "@/components/project/cleanup-review"
import { EditingDocumentCard } from "@/components/project/editing-document-card"
import { CopyReview } from "@/components/project/copy-review"
import { MediaSettings } from "@/components/project/media-settings"
import { ProjectHeader } from "@/components/project/project-header"
import { RunStrip } from "@/components/project/run-strip"
import { SceneList } from "@/components/project/scene-list"
import { ShotlistCard } from "@/components/project/shotlist-card"
import { SourceScriptEditor } from "@/components/project/source-script"
import { Stage } from "@/components/project/stage"
import { StyleGuideEditor } from "@/components/project/style-guide-editor"
import { PlanReviewCard } from "@/components/project/plan-review-card"
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
 * Approve/apply actions (`hooks/use-pipeline.ts`) are direct writes, not
 * `run.resume()` calls — what's on screen when the user clicks Approve is
 * what gets sent, and nothing is waiting on a suspended workflow to line up
 * with.
 *
 * The page itself is a list of stages (`lib/stages.ts`) rather than a progress
 * panel above a row of tabs. Each stage owns both a run of pipeline steps and
 * the UI for what they produce, so watching a phase and acting on it are the
 * same place, and the page opens on whichever one is asking for something.
 */
export function ProjectWorkspace({ project: fromDisk }: { project: Project }) {
  const router = useRouter()

  /** Edits made since the last server read. */
  const [local, setLocal] = React.useState<Partial<Project>>({})

  // The stream closing means the action that ran has already written to
  // `project.json`. Re-reading makes the server authoritative again and
  // retires the local overlay. Memoized because `useChat` keeps one instance.
  const onSettled = React.useCallback(() => {
    setLocal({})
    router.refresh()
  }, [router])

  const pipeline = usePipeline(fromDisk.path, { onSettled })

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
  const [planDecisions, setPlanDecisions] = React.useState<
    Record<string, PlanElementDecision>
  >({})
  const [sectionDecisions, setSectionDecisions] = React.useState<
    Record<string, PlanSectionDecision>
  >({})

  /**
   * Disk, then local edits, then the live run, then this round's decisions.
   *
   * The run wins over local edits on purpose. A span the user toggled is only
   * theirs until the workflow confirms what it actually did with it, and the
   * confirmation is the thing worth showing. It also means local edits retire
   * themselves as the run reports, with nothing to clear.
   *
   * Scene decisions are the exception, and have to come last. `applyPatch`
   * merges the run's scenes by id and, for any scene the run has reported on,
   * its version wins — so anything merged before it is replaced by those
   * scenes on the next render, which is exactly what made Approve and Reject
   * look like dead buttons.
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

  /**
   * Every action below is a direct, one-shot call (`hooks/use-pipeline.ts`) —
   * no run to check for, no gate to be lined up with. `pipeline.streaming`
   * already disables the buttons while one is in flight (`useChat` holds one
   * stream at a time), so there's nothing left to guard here.
   */
  function runScan() {
    pipeline.send({ kind: "scan", projectPath: project.path })
    toast.add({
      title: "Scanning",
      description: "Media settings carry forward from what's already set.",
    })
  }

  function runTranscribe() {
    pipeline.send({ kind: "transcribe", projectPath: project.path })
    toast.add({
      title: "Transcribing",
      description: "Cleanup, the plan and scenes are untouched.",
    })
  }

  function runProposeCleanup() {
    pipeline.send({ kind: "propose-cleanup", projectPath: project.path })
    toast.add({
      title: "Proposing cuts",
      description: "Replaces the current proposal — nothing downstream moves.",
    })
  }

  function approveCleanup() {
    // The spans on screen, not the ones the agent proposed. Every toggle the
    // user made is part of what gets approved.
    pipeline.send({
      kind: "approve-cleanup",
      projectPath: project.path,
      spans: project.spans,
    })
    toast.add({
      title: "Cleanup approved",
      description: "The structural analysis reads this script next.",
    })
  }

  function reopenCleanup() {
    patch({ cleanupApprovedAt: null })
  }

  function runAnalyzePlan() {
    pipeline.send({ kind: "analyze-plan", projectPath: project.path })
    toast.add({
      title: "Analyzing structure",
      description: "Replaces the current proposal's automatic elements.",
    })
  }

  function runGenerateScenes() {
    pipeline.send({ kind: "generate-scenes", projectPath: project.path })
    toast.add({
      title: "Generating scenes",
      description: "Scenes already ready, approved or exported are left alone.",
    })
  }

  function runExportApproved() {
    pipeline.send({ kind: "export-approved", projectPath: project.path })
    toast.add({
      title: "Exporting",
      description: "Approved scenes and titles, serialized one at a time.",
    })
  }

  function runWriteCopy() {
    pipeline.send({ kind: "write-copy", projectPath: project.path })
    toast.add({
      title: "Writing copy",
      description: "From the approved script.",
    })
  }

  function runWriteShotlist() {
    pipeline.send({ kind: "write-shotlist", projectPath: project.path })
    toast.add({
      title: "Writing shot list",
      description: "From the exported scenes.",
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Gate 2 + 4 — timeline export and composite, merged into one control     */
  /* ---------------------------------------------------------------------- */

  /**
   * ADR 0009: writing the cut and compositing it are deterministic and
   * cheap, so this is a plain request outside the workflow entirely — not
   * a `run.resume()`, no gate to be lined up with, available whether or
   * not a pipeline run is active. `router.refresh()` picks up what it
   * wrote the same way `persist()` does for a settings PATCH.
   */
  function updateTimeline(maxSilenceSec: number) {
    return updateTimelineRequest(project.id, maxSilenceSec)
      .then(() => {
        toast.add({
          title: "Timeline updated",
          description: "Exported and recomposited from the current script.",
        })
        router.refresh()
      })
      .catch((error: Error) => {
        toast.add({
          title: "Couldn't update the timeline",
          description: error.message,
        })
      })
  }

  /* ---------------------------------------------------------------------- */
  /* Gate 3 — scenes                                                         */
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

  /**
   * Applies everything decided so far — a direct write, not a resume.
   * Exporting approved scenes is its own separate action now (`Export
   * approved`, in the header once there's something to render).
   */
  function submitReview() {
    const pending = Object.values(decisions)
    const regenerating = pending.filter(
      (decision) => decision.action === "regenerate"
    ).length
    pipeline.send({
      kind: "apply-scenes",
      projectPath: project.path,
      decisions: pending,
    })
    setDecisions({})
    toast.add({
      title: regenerating > 0 ? "Regenerating" : "Review applied",
      description:
        regenerating > 0
          ? `${regenerating} scene${regenerating === 1 ? "" : "s"} sent back.`
          : "Approved scenes are ready to export.",
    })
  }

  function decidePlanElement(decision: PlanElementDecision) {
    setPlanDecisions((current) => ({
      ...current,
      [decision.id]: { ...current[decision.id], ...decision },
    }))
  }

  function decidePlanSection(decision: PlanSectionDecision) {
    setSectionDecisions((current) => ({
      ...current,
      [decision.id]: { ...current[decision.id], ...decision },
    }))
  }

  function acceptPlanSection(sectionId: string) {
    for (const element of project.editingDocument.elements) {
      if (
        element.sectionId === sectionId &&
        element.status !== "orphaned" &&
        element.status !== "conflict"
      ) {
        decidePlanElement({ id: element.id, action: "approve" })
      }
    }
  }

  function submitPlanReview() {
    const decisions = resolvePlanReviewDecisions(
      project.editingDocument.elements,
      planDecisions
    )

    pipeline.send({
      kind: "apply-plan",
      projectPath: project.path,
      elementDecisions: decisions,
      sectionDecisions: Object.values(sectionDecisions),
      done: true,
    })
    setPlanDecisions({})
    setSectionDecisions({})
    toast.add({
      title: "Plan approved",
      description: "Accepted visual elements will be rendered next.",
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

  function saveSourceScript(sourceScript: string | null) {
    persist(
      { sourceScript },
      "Original script saved",
      "Used as context the next time the structural analysis runs."
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

  /**
   * A manually-added element (title, zoom or scene), and any decision on
   * one — approve, reject, edit. Unlike a span toggle, this is never
   * pipeline output the run confirms — it's the creator's own intention —
   * so it's a direct `persist`, the same as media settings or the style
   * guide, rather than something held for a gate to approve.
   */
  function saveEditingDocument(editingDocument: EditingDocument) {
    persist(
      { editingDocument },
      "Element saved",
      "Approved elements render the next time the pipeline runs."
    )
  }

  const counts = sceneCounts(project.scenes)
  const pendingScenes = project.scenes.filter(
    (scene) => scene.status === "pending"
  ).length
  const hasTranscriptionSource = project.media.some(
    (file) => file.hasAudio && file.transcribe
  )

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
   * There's something new to say — and the previous submit isn't still
   * writing. `applySceneDecisions` is a direct write, not a resume, but two
   * of them in flight at once could still race on the same scene.
   */
  const canSubmitReview = !pipeline.streaming && decided.length > 0

  /** No proposal, or a proposal nobody has approved yet. */
  const cleanupPending = project.cleanupApprovedAt === null

  /** A structural analysis has run and nobody has approved its plan yet. */
  const planPending =
    project.editingDocument.analysisAt !== null &&
    project.editingDocument.reviewedAt === null

  const exportable =
    project.scenes.some((scene) => scene.status === "approved") ||
    project.editingDocument.elements.some(
      (element) =>
        element.type === "title" &&
        element.status === "approved" &&
        element.exportPath == null
    )

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
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Walks the folder and probes every file. Settings already set —
            roles, sync — carry forward.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={runScan}
            disabled={pipeline.streaming}
          >
            {project.media.length > 0 ? "Re-scan" : "Scan"}
          </Button>
        </div>
        <Separator />
        <SourceScriptEditor
          sourceScript={project.sourceScript}
          onSave={saveSourceScript}
        />
        <Separator />
        <MediaSettings media={project.media} onSave={saveMedia} />
        <Separator />
        <TranscriptionHintsEditor
          hints={project.transcriptionHints}
          locked={project.transcript.words.length > 0}
          onSave={saveHints}
        />
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {hasTranscriptionSource
              ? "Only rewrites the transcript — cleanup, the plan and scenes are untouched."
              : "Mark a file as a transcription source above first."}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={runTranscribe}
            disabled={pipeline.streaming || !hasTranscriptionSource}
          >
            Transcribe
          </Button>
        </div>
        {project.transcript.words.length > 0 ? (
          <>
            <Separator />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {project.spans.length > 0
                  ? "Replaces the current proposal with a fresh one."
                  : "Nothing proposed yet."}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={runProposeCleanup}
                disabled={pipeline.streaming}
              >
                {project.spans.length > 0 ? "Re-propose cuts" : "Propose cuts"}
              </Button>
            </div>
          </>
        ) : null}
        {project.spans.length > 0 ? (
          <>
            <Separator />
            <CleanupReview
              project={project}
              onToggleSpan={toggleSpan}
              onReopen={reopenCleanup}
              pending={cleanupPending}
            />
          </>
        ) : null}
      </>
    ),

    scenes: (
      <>
        <StyleGuideEditor
          styleGuide={project.styleGuide}
          onSave={saveStyleGuide}
        />
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {project.cleanupApprovedAt === null
              ? "Approve cleanup first — the analysis reads the approved script."
              : project.editingDocument.analysisAt !== null
                ? "Replaces the proposal's automatic sections and elements — manual ones stay."
                : "Nothing proposed yet."}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={runAnalyzePlan}
            disabled={pipeline.streaming || project.cleanupApprovedAt === null}
          >
            {project.editingDocument.analysisAt !== null
              ? "Re-analyze structure"
              : "Analyze structure"}
          </Button>
        </div>
        <Separator />
        <PlanReviewCard
          project={project}
          active={planPending}
          elementDecisions={Object.values(planDecisions)}
          sectionDecisions={Object.values(sectionDecisions)}
          onElementDecision={decidePlanElement}
          onSectionDecision={decidePlanSection}
          onAcceptSection={acceptPlanSection}
        />
        {pendingScenes > 0 ? (
          <>
            <Separator />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {pendingScenes} scene{pendingScenes === 1 ? "" : "s"} waiting to
                be generated — scenes already ready, approved or exported are
                left alone.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={runGenerateScenes}
                disabled={pipeline.streaming}
              >
                {`Generate ${pendingScenes} scene${pendingScenes === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        ) : null}
        {exportable ? (
          <>
            <Separator />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Approved scenes and titles, rendered to ProRes — serialized, one
                at a time.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={runExportApproved}
                disabled={pipeline.streaming}
              >
                Export approved
              </Button>
            </div>
          </>
        ) : null}
        <Separator />
        <SceneList
          project={project}
          drafts={pipeline.drafts}
          decisions={decisions}
          onApprove={approveScene}
          onReject={rejectScene}
          onRegenerate={regenerateScene}
        />
      </>
    ),

    deliverables: (
      <>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Written from the approved script.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={runWriteCopy}
            disabled={pipeline.streaming || project.spans.length === 0}
          >
            {project.copy === null ? "Write copy" : "Rewrite copy"}
          </Button>
        </div>
        <Separator />
        <CopyReview copy={project.copy} />
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Written from the exported scenes.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={runWriteShotlist}
            disabled={pipeline.streaming || counts.exported === 0}
          >
            Write shot list
          </Button>
        </div>
        <Separator />
        <ShotlistCard project={project} />
      </>
    ),
  }

  /**
   * The one thing each stage is for, hoisted into its header — but only while
   * there's actually something to do. A disabled button that just repeats
   * "Approved" duplicates the detail line's own "· approved", so once a gate
   * is cleared the header goes quiet and the detail text is the only place
   * that says so.
   */
  const action: Partial<Record<StageId, React.ReactNode>> = {
    footage:
      project.spans.length > 0 && cleanupPending ? (
        <Button
          size="sm"
          onClick={approveCleanup}
          disabled={pipeline.streaming}
        >
          <HugeiconsIcon
            icon={Tick02Icon}
            strokeWidth={2}
            data-icon="inline-start"
          />
          Approve cleanup
        </Button>
      ) : undefined,

    scenes: planPending ? (
      <Button
        size="sm"
        onClick={submitPlanReview}
        disabled={pipeline.streaming}
      >
        Approve plan
      </Button>
    ) : canSubmitReview ? (
      <Button size="sm" onClick={submitReview}>
        {regenerating > 0
          ? `Send ${regenerating} back`
          : `Submit review (${decided.length})`}
      </Button>
    ) : undefined,
  }

  return (
    <main className="mx-auto flex w-full max-w-[92rem] flex-col gap-6 px-6 py-10">
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

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[1fr_28rem]">
        <div className="flex min-w-0 flex-col gap-3">
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

        {/*
         * The editing document, always on screen rather than folded inside
         * one stage's accordion — issue #5's whole point is that it stays
         * present across every step and fills in as the pipeline runs, so
         * hiding it behind "cleanup" defeated that the moment any other
         * stage was open.
         */}
        <div className="max-h-[calc(100vh-3rem)] min-w-0 overflow-y-auto xl:sticky xl:top-6">
          <EditingDocumentCard
            project={project}
            onSaveEditingDocument={saveEditingDocument}
            timeline={pipeline.timeline}
            composite={pipeline.composite}
            disabled={pipeline.streaming}
            onUpdateTimeline={updateTimeline}
          />
        </div>
      </div>
    </main>
  )
}
