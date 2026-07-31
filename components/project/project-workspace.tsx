"use client"

import * as React from "react"

import { sceneCounts } from "@/lib/project"
import type { Project, Run, Scene, StyleGuide } from "@/lib/types"
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
 * Every mutation here corresponds to a call the API routes will make: approvals
 * resume a suspended workflow run (`run.resume({ resumeData })`), and each step
 * writes the deliverable back into `project.json`. Until those exist, the edits
 * are local to the session.
 */
export function ProjectWorkspace({
  project: initialProject,
  run,
}: {
  project: Project
  run: Run | null
}) {
  const [project, setProject] = React.useState(initialProject)

  function patch(next: Partial<Project>) {
    setProject((current) => ({ ...current, ...next }))
  }

  function patchScene(id: string, next: Partial<Scene>) {
    setProject((current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.id === id ? { ...scene, ...next } : scene
      ),
    }))
  }

  function toggleSpan(index: number) {
    setProject((current) => ({
      ...current,
      spans: current.spans.map((span, i) =>
        i === index
          ? { ...span, action: span.action === "cut" ? "keep" : "cut" }
          : span
      ),
    }))
  }

  function approveCleanup() {
    patch({ cleanupApprovedAt: new Date().toISOString() })
    toast.add({
      title: "Cleanup approved",
      description: "Run resumed — the scenario agent reads the approved script.",
    })
  }

  function reopenCleanup() {
    patch({ cleanupApprovedAt: null })
    toast.add({
      title: "Cleanup reopened",
      description: "Steps 5 and up are gated again until you re-approve.",
    })
  }

  function approveScene(id: string) {
    patchScene(id, { status: "approved" })
  }

  function rejectScene(id: string) {
    patchScene(id, { status: "rejected" })
  }

  function regenerateScene(id: string, note: string) {
    patchScene(id, { status: "generating", note: note || undefined })
    toast.add({
      title: `Regenerating ${id}`,
      description: note ? `Note: ${note}` : "Same window, same style guide.",
    })
  }

  function exportScene(id: string) {
    patchScene(id, { status: "exporting" })
    toast.add({
      title: `Exporting ${id}`,
      description: `Frame-stepping at ${project.fps} fps, then ProRes 4444.`,
    })
  }

  function exportApproved() {
    const pending = project.scenes.filter((scene) => scene.status === "approved")
    setProject((current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.status === "approved" ? { ...scene, status: "exporting" } : scene
      ),
    }))
    toast.add({
      title: `Queued ${pending.length} exports`,
      description: "Serialized — one Playwright and ffmpeg job at a time.",
    })
  }

  function saveStyleGuide(styleGuide: StyleGuide) {
    patch({ styleGuide })
    toast.add({ title: "Style guide saved to project.json" })
  }

  const counts = sceneCounts(project.scenes)
  const pendingReview = project.scenes.filter(
    (scene) => scene.status === "ready"
  ).length

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <ProjectHeader
        project={project}
        run={run}
        onFpsChange={(fps) => patch({ fps })}
        onRun={() =>
          toast.add({
            title: "Run started",
            description: "Progress streams in from the workflow as steps finish.",
          })
        }
        onReveal={() =>
          toast.add({
            title: "Revealed in Finder",
            description: project.path,
          })
        }
      />

      <PipelineProgress
        run={run}
        onCancel={() => toast.add({ title: "Cancel requested" })}
      />

      <Tabs defaultValue="scenes">
        <TabsList>
          <TabsTrigger value="cleanup">
            Cleanup
            {project.cleanupApprovedAt === null ? (
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
              onExport={exportScene}
              onExportAll={exportApproved}
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
