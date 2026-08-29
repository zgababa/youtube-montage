/**
 * Step 10 — YouTube and Twitter copy.
 *
 * Runs on the approved script, never the raw transcript (idea.md §4). The
 * script handed to the agent is built by filtering the transcript through the
 * approved spans, so anything the user cut is already gone and the copy can't
 * promise content that isn't in the edit.
 */

import { copyAgent } from "../agents/copy-agent"
import { readStoredProject, updateProject } from "../lib/project"
import { buildSegments, keptSegments, renderScript } from "../lib/segments"
import { generateStructured } from "../lib/structured"
import { ProjectCopySchema } from "../schemas"
import type { PipelineWriter } from "../stream/contract"
import { reporter, runStep } from "./shared"

/** `app/api/pipeline/route.ts` calls this for the "Write copy" action. */
export async function writeCopy(
  projectPath: string,
  writer: PipelineWriter | undefined
) {
  const report = reporter("copy", writer)

  return runStep(report, async () => {
    const project = await readStoredProject(projectPath)
    const script = renderScript(
      keptSegments(buildSegments(project.transcript.words), project.spans)
    )

    if (!script) {
      throw new Error("No approved script to write copy from.")
    }

    const copy = await generateStructured({
      agent: copyAgent,
      schema: ProjectCopySchema,
      label: "copy",
      prompt: [
        `Write the publishing copy for "${project.name}".`,
        "",
        "The approved script, with timecodes:",
        "",
        script,
      ].join("\n"),
    })

    await updateProject(projectPath, (current) => ({ ...current, copy }))
    await report.emit("copy", { copy })

    return { projectPath }
  })
}
