/**
 * Quick demo: generates a sample FCPXML with all new transition types and SFX.
 *
 * Run: bun scripts/demo-transitions-sfx.ts
 * Output: demo-output.fcpxml in the project root
 */

import { buildFcpxml, type SfxClip, type TransitionSpec } from "../src/mastra/lib/fcpxml"
import type { StoredProject, MediaFile } from "../src/mastra/schemas"
import fs from "node:fs"

const media: MediaFile = {
  path: "raw/talk.mp4",
  durationSec: 300,
  hasAudio: true,
  hasVideo: true,
  transcribe: true,
  offsetSec: 0,
  voices: null,
}

const proj: StoredProject = {
  version: 1,
  id: "demo",
  path: "/tmp/demo-project",
  name: "Demo SFX & Transitions",
  createdAt: new Date().toISOString(),
  fps: 30,
  media: [media],
  transcriptionHints: { prompt: "", keyterms: [] },
  sourceScript: null,
  transcript: { words: [] },
  spans: [],
  cleanupApprovedAt: null,
  maxSilenceSec: 0.3,
  timelineApprovedAt: null,
  compositeApprovedAt: null,
  styleGuide: { palette: [], fontStack: "", motion: "", notes: "" },
  scenes: [],
  editingDocument: { sections: [], elements: [], analysisAt: null, reviewedAt: null },
  copy: null,
}

const runs = [
  { file: "raw/talk.mp4", sourceStart: 0, sourceEnd: 10 },
  { file: "raw/talk.mp4", sourceStart: 12, sourceEnd: 22 },
  { file: "raw/talk.mp4", sourceStart: 24, sourceEnd: 34 },
  { file: "raw/talk.mp4", sourceStart: 36, sourceEnd: 46 },
  { file: "raw/talk.mp4", sourceStart: 48, sourceEnd: 58 },
]

const transitions: TransitionSpec[] = [
  { runIndex: 1, type: "crossfade", durationSec: 0.5 },
  { runIndex: 2, type: "wipe-diagonal", durationSec: 0.5 },
  { runIndex: 3, type: "push-right", durationSec: 0.5 },
  { runIndex: 4, type: "dip-to-black", durationSec: 0.5 },
]

const sfxClips: SfxClip[] = [
  { sfxType: "transition", runIndex: 1, runOffset: 10, durationSec: 0.8 },
  { sfxType: "swoosh", runIndex: 2, runOffset: 22, durationSec: 0.6 },
  { sfxType: "swoosh", runIndex: 3, runOffset: 34, durationSec: 0.6 },
  { sfxType: "thud", runIndex: 4, runOffset: 46, durationSec: 0.4 },
  { sfxType: "whoosh", runIndex: 0, runOffset: 3, durationSec: 0.5 },
  { sfxType: "pop", runIndex: 2, runOffset: 25, durationSec: 0.3 },
]

const xml = buildFcpxml(proj, runs, [], null, [], transitions, sfxClips)
const outPath = "demo-output.fcpxml"
fs.writeFileSync(outPath, xml, "utf8")

console.log(`Written to ${outPath}`)
console.log(`  - ${transitions.length} transitions (crossfade, wipe-diagonal, push-right, dip-to-black)`)
console.log(`  - ${sfxClips.length} SFX clips on lane -1`)
console.log(`  - ${runs.length} spine runs`)
console.log()
console.log("Open in DaVinci Resolve: File → Import → Timeline → select demo-output.fcpxml")
