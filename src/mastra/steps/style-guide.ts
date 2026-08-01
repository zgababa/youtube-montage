/**
 * Step 5 — one visual language for the whole project.
 *
 * Not in idea.md's §4 step table, but §5 requires it: the style guide is
 * "generated once per project and passed to every scene agent… without it,
 * parallel agents produce visually inconsistent scenes". Giving it its own step
 * means it can be re-run from Studio to try a different look without
 * regenerating any scenes.
 */

import { createStep } from "@mastra/core/workflows"

import { styleAgent } from "../agents/style-agent"
import { readStoredProject, updateProject } from "../lib/project"
import { buildSegments, keptSegments, renderScript } from "../lib/segments"
import { generateStructured } from "../lib/structured"
import { StyleGuideSchema } from "../schemas"
import { PipelineIO, reporter, runStep } from "./shared"

/** Enough to establish register and subject without paying for the whole talk. */
const SAMPLE_LINES = 120

export const styleGuideStep = createStep({
  id: "style-guide",
  description: "Generate the palette, typography and motion character",
  inputSchema: PipelineIO,
  outputSchema: PipelineIO,
  execute: async ({ inputData, writer }) => {
    const report = reporter("style-guide", writer)
    const { projectPath } = inputData

    return runStep(report, async () => {
      const project = await readStoredProject(projectPath)
      const segments = keptSegments(
        buildSegments(project.transcript.words),
        project.spans
      )

      const sample = renderScript(segments.slice(0, SAMPLE_LINES))

      const styleGuide = await generateStructured({
        agent: styleAgent,
        schema: StyleGuideSchema,
        label: "style-guide",
        prompt: [
          `Define the visual language for the animated overlays in "${project.name}".`,
          "",
          "The opening of the script:",
          "",
          sample,
        ].join("\n"),
      })

      await updateProject(projectPath, (current) => ({
        ...current,
        styleGuide,
      }))
      await report.emit("style-guide", { styleGuide })

      return { projectPath }
    })
  },
})
