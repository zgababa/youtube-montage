/**
 * Writes the cut timeline as FCPXML.
 *
 * Deterministic and cheap (ADR 0009) — no LLM call, nothing to review — so
 * it's called directly by `app/api/projects/[id]/timeline/route.ts` rather
 * than gated behind anything. The silence cap is a setting a human can
 * revisit any time through that same action, which re-derives everything
 * below from the project's current state.
 */

import fs from "node:fs/promises"

import { buildFcpxml } from "../lib/fcpxml"
import { fcpxmlPath } from "../lib/paths"
import { buildSegments } from "../lib/segments"
import { buildKeptRuns, type TimelineRun } from "../lib/timeline"
import type { StoredProject } from "../schemas"

/**
 * Rebuilds the runs and writes `timeline.fcpxml`, returning what the UI
 * shows.
 */
export async function writeTimeline(
  project: StoredProject,
  maxSilenceSec: number
) {
  const segments = buildSegments(project.transcript.words)
  const runs = buildKeptRuns(
    segments,
    project.spans,
    project.media,
    maxSilenceSec
  )

  const xml = buildFcpxml(project, runs)
  const file = fcpxmlPath(project.path)
  await fs.writeFile(file, xml, "utf8")

  return {
    path: file,
    runsCount: runs.length,
    totalDurationSec: totalDuration(runs),
  }
}

function totalDuration(runs: TimelineRun[]): number {
  return runs.reduce((sum, run) => sum + (run.sourceEnd - run.sourceStart), 0)
}
