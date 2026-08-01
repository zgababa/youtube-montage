"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { applyPatch } from "@/lib/run-reducer"
import { reveal } from "@/lib/client-api"
import { sceneCounts } from "@/lib/project"
import type { Project, Scene, Span, StyleGuide } from "@/lib/types"
import type { SceneDecision } from "@/src/mastra/stream/contract"
import { usePipeline } from "@/hooks/use-pipeline"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import { CleanupReview } from "@/components/project/cleanup-review"
import { CopyReview } from "@/components/project/copy-review"
import { PipelineProgress } from "@/components/project/pipeline-progress"
import { ProjectHeader } from "@/components/project/project-header"
import { SceneList } from "@/components/project/scene-list"
import { ShotlistCard } from "@/components/project/shotlist-card"
import { StyleGuideEditor } from "@/components/project/style-guide-editor"

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
 */
export function ProjectWorkspace({ project: fromDisk }: { project: Project }) {
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

  const pipeline = usePipeline(fromDisk.path, { onSettled })

  /**
   * Disk, then local edits, then the live run — in that order.
   *
   * The run wins over local edits on purpose. A span the user toggled is only
   * theirs until the workflow confirms what it actually did with it, and the
   * confirmation is the thing worth showing. It also means local edits retire
   * themselves as the run reports, with nothing to clear.
   */
  const project = React.useMemo(
    () => applyPatch(applyPatch(fromDisk, local), pipeline.patch),
    [fromDisk, local, pipeline.patch]
  )

  function patch(next: Partial<Project>) {
    setLocal((current) => ({ ...current, ...next }))
  }

  function patchScene(id: string, next: Partial<Scene>) {
    setLocal((current) => ({
      ...current,
      scenes: (current.scenes ?? project.scenes).map((scene) =>
        scene.id === id ? { ...scene, ...next } : scene
      ),
    }))
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
   * Decisions are collected locally and submitted together.
   *
   * One resume per click would be wrong: each `run.resume()` restarts the step,
   * so approving twelve scenes individually would be twelve round trips through
   * the gate.
   */
  const [decisions, setDecisions] = React.useState<
    Record<string, SceneDecision>
  >({})

  function decide(decision: SceneDecision) {
    setDecisions((current) => ({ ...current, [decision.id]: decision }))
  }

  function approveScene(id: string) {
    decide({ id, action: "approve" })
    patchScene(id, { status: "approved" })
  }

  function rejectScene(id: string) {
    decide({ id, action: "reject" })
    patchScene(id, { status: "rejected" })
  }

  function regenerateScene(id: string, note: string) {
    decide({ id, action: "regenerate", note: note || undefined })
    patchScene(id, { status: "generating", note: note || undefined })
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
    patch({ styleGuide })
    toast.add({
      title: "Style guide updated",
      description: "Applies to the next scenes generated.",
    })
  }

  const counts = sceneCounts(project.scenes)
  const pendingReview = project.scenes.filter(
    (scene) => scene.status === "ready"
  ).length
  const hasRegenerations = Object.values(decisions).some(
    (decision) => decision.action === "regenerate"
  )

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <ProjectHeader
        project={project}
        run={pipeline.run}
        onFpsChange={(fps) => patch({ fps })}
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

      <PipelineProgress run={pipeline.run} onCancel={pipeline.stop} />

      <Tabs defaultValue="scenes">
        <TabsList>
          <TabsTrigger value="cleanup">
            Cleanup
            {project.spans.length > 0 && project.cleanupApprovedAt === null ? (
              <Badge variant="secondary">needs you</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="scenes">
            Scenes
            {pendingReview > 0 ? (
              <Badge variant="secondary">{pendingReview}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="copy">Copy</TabsTrigger>
          <TabsTrigger value="style">Style guide</TabsTrigger>
        </TabsList>

        <TabsContent value="cleanup" className="pt-4">
          <CleanupReview
            project={project}
            onToggleSpan={toggleSpan}
            onApprove={approveCleanup}
            onReopen={reopenCleanup}
          />
        </TabsContent>

        <TabsContent value="scenes" className="pt-4">
          <div className="flex flex-col gap-6">
            <SceneList
              project={project}
              onApprove={approveScene}
              onReject={rejectScene}
              onRegenerate={regenerateScene}
              onExport={() => submitReview(true)}
              onExportAll={() => submitReview(!hasRegenerations)}
            />
            {counts.approved > 0 ? <ShotlistCard project={project} /> : null}
          </div>
        </TabsContent>

        <TabsContent value="copy" className="pt-4">
          <CopyReview copy={project.copy} />
        </TabsContent>

        <TabsContent value="style" className="pt-4">
          <StyleGuideEditor
            styleGuide={project.styleGuide}
            onSave={saveStyleGuide}
          />
        </TabsContent>
      </Tabs>
    </main>
  )
}
