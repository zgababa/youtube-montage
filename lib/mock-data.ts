/**
 * Fixtures standing in for `project.json` and `run.stream()` events.
 *
 * Everything the UI reads goes through `lib/api.ts`; this file is what that
 * module returns until the Mastra workflow and the API routes in idea.md §8
 * are wired up. Shapes match `lib/types.ts` exactly, so swapping the source is
 * a change in one file.
 */

import {
  SCENE_03_HTML,
  SCENE_04_HTML,
  SCENE_06_HTML,
  SCENE_07_HTML,
  SCENE_09_HTML,
} from "@/lib/scene-html"
import type {
  DirListing,
  Project,
  ProjectSummary,
  Run,
  Scene,
  Span,
  SpanCategory,
  Word,
} from "@/lib/types"

const SOURCE_FILE = "raw/a-cam-01.mp4"

/**
 * The transcript, authored as segments so the cut decisions line up with real
 * sentence boundaries. Word-level timings are interpolated below — in the real
 * pipeline they come straight from the STT provider (§4.1).
 */
const SEGMENTS: {
  text: string
  cut?: SpanCategory
  reason?: string
}[] = [
  { text: "So" , cut: "filler", reason: "leading filler" },
  {
    text: "the problem with b-roll is not that it is hard to make, it is that deciding where it goes takes longer than making it.",
  },
  { text: "um, yeah", cut: "filler", reason: "filler" },
  {
    text: "I record an hour of footage, and then I sit there scrubbing the timeline trying to remember which bit needed a diagram.",
  },
  {
    text: "I record an hour and then scrub through the whole thing looking for the spots that need help.",
    cut: "redundant",
    reason: "redundant with 00:14",
  },
  {
    text: "So this tool points at a folder of raw footage and does the deciding for me.",
  },
  { text: "you know", cut: "filler", reason: "filler" },
  {
    text: "First it transcribes everything with word-level timestamps, which turns out to be the whole ballgame.",
  },
  {
    text: "And I want to be really clear about why word-level matters, because I got this wrong the first time.",
  },
  {
    text: "Actually — no, let me back up.",
    cut: "false_start",
    reason: "false start",
  },
  {
    text: "The naive version asks a model to clean up the transcript, and the model hands you back nice clean prose.",
  },
  {
    text: "And that prose is useless, because it no longer maps to any moment in any file.",
  },
  {
    text: "So instead the model never rewrites anything. It emits decisions on spans.",
  },
  {
    text: "Keep this range, cut this range, and here is the reason and the category.",
  },
  {
    text: "The clean script you see in the app is just the kept spans rendered in order. It is derived, never stored.",
  },
  {
    text: "which, by the way, is also how the chapters work, and how the cut suggestions would work if I ever build them, and honestly it is how I would do subtitles too, there is a whole thing there about how span data is more useful than text data in general and I could talk about that for an hour",
    cut: "tangent",
    reason: "tangent, 22s off-topic",
  },
  {
    text: "Anyway. Once the spans are approved, a second agent reads the approved script and decides where b-roll would actually help.",
  },
  {
    text: "It gives me a placement, an intent, a type, and the available window — the length of the gap it has to fill.",
  },
  { text: "uh", cut: "filler", reason: "filler" },
  {
    text: "Then a third agent writes each scene as one self-contained HTML file.",
  },
  {
    text: "No canvas, no Lottie, no video. All motion is CSS animations or the Web Animations API.",
  },
  {
    text: "And that constraint is not aesthetic, it is the entire reason the export works.",
  },
  {
    text: "Sorry, let me say that again, the constraint is—",
    cut: "bad_take",
    reason: "restarted mid-sentence",
  },
  {
    text: "The exporter pauses every animation and steps currentTime forward one frame at a time.",
  },
  {
    text: "Anything driven by a JavaScript clock renders frozen in the export while looking perfect in the preview.",
  },
  {
    text: "That is the bug you find three weeks in, after you have generated ninety scenes.",
  },
  {
    text: "Playwright screenshots each frame with omitBackground on, so the PNGs keep their alpha.",
  },
  {
    text: "ffmpeg turns those into ProRes 4444, and the scenes overlay the footage instead of cutting away from it.",
  },
  {
    text: "the scenes sit on top of the footage rather than replacing it",
    cut: "redundant",
    reason: "redundant with 04:41",
  },
  {
    text: "I approve or reject each one in the browser, and only the approved ones get exported.",
  },
  {
    text: "Exports run one at a time, because four concurrent Playwright and ffmpeg jobs makes the machine unusable.",
  },
  { text: "so, like", cut: "filler", reason: "filler" },
  {
    text: "What I end up with is a folder of mov files and a text file that tells me where each one goes.",
  },
  {
    text: "That text file sits on the second monitor while I cut, and that is the whole product.",
  },
  {
    text: "It is not an editor. It never touches my timeline. It just does the part I was bad at.",
  },
]

const WORD_SEC = 0.34
const SEGMENT_GAP = 0.18

function buildTranscript() {
  const words: Word[] = []
  const spans: Span[] = []
  let t = 12.1

  for (const segment of SEGMENTS) {
    const tokens = segment.text.split(/\s+/).filter(Boolean)
    const start = t
    for (const token of tokens) {
      words.push({
        w: token,
        start: Number(t.toFixed(2)),
        end: Number((t + WORD_SEC * 0.86).toFixed(2)),
        file: SOURCE_FILE,
      })
      t += WORD_SEC
    }
    spans.push({
      start: Number(start.toFixed(2)),
      end: Number(t.toFixed(2)),
      action: segment.cut ? "cut" : "keep",
      ...(segment.cut ? { category: segment.cut, reason: segment.reason } : {}),
    })
    t += SEGMENT_GAP
  }

  return { words, spans }
}

const { words, spans } = buildTranscript()

const SCENES: Scene[] = [
  {
    id: "scene_03",
    scriptStart: 252.0,
    scriptEnd: 259.0,
    windowSec: 7.0,
    coversLine: "the agent picks up the job from the queue",
    sourceFile: SOURCE_FILE,
    intent: "diagram of the job queue, replaces the hand-wave",
    type: "diagram",
    status: "approved",
    htmlPath: "scenes/scene_03.html",
    exportPath: "exports/scene_03.mov",
    measuredDurationSec: 6.4,
    html: SCENE_03_HTML,
  },
  {
    id: "scene_04",
    scriptStart: 348.0,
    scriptEnd: 354.0,
    windowSec: 6.0,
    coversLine: "three passes run in parallel",
    sourceFile: SOURCE_FILE,
    intent: "show the three concurrent passes filling at slightly different rates",
    type: "process",
    status: "exported",
    htmlPath: "scenes/scene_04.html",
    exportPath: "exports/scene_04.mov",
    measuredDurationSec: 5.5,
    html: SCENE_04_HTML,
  },
  {
    id: "scene_06",
    scriptStart: 412.5,
    scriptEnd: 419.5,
    windowSec: 7.0,
    coversLine: "First it transcribes everything with word-level timestamps",
    sourceFile: SOURCE_FILE,
    intent: "the actual word payload, so the timestamps are concrete",
    type: "code",
    status: "ready",
    htmlPath: "scenes/scene_06.html",
    exportPath: null,
    measuredDurationSec: 8.2,
    html: SCENE_06_HTML,
  },
  {
    id: "scene_07",
    scriptStart: 501.0,
    scriptEnd: 506.5,
    windowSec: 5.5,
    coversLine: "deviceScaleFactor two, with a nine-sixty by five-forty viewport",
    sourceFile: SOURCE_FILE,
    intent: "cost of the export at each resolution",
    type: "data",
    status: "ready",
    htmlPath: "scenes/scene_07.html",
    exportPath: null,
    measuredDurationSec: 4.8,
    html: SCENE_07_HTML,
  },
  {
    id: "scene_08",
    scriptStart: 553.0,
    scriptEnd: 559.0,
    windowSec: 6.0,
    coversLine: "ffmpeg turns those into ProRes 4444",
    sourceFile: SOURCE_FILE,
    intent: "the pixel format chain, png with alpha through to yuva444p10le",
    type: "concept",
    status: "failed",
    htmlPath: null,
    exportPath: null,
    measuredDurationSec: null,
    html: null,
    error:
      "sceneAgent returned markup containing a <canvas> element; rejected by the validator (§5).",
  },
  {
    id: "scene_09",
    scriptStart: 604.0,
    scriptEnd: 612.0,
    windowSec: 8.0,
    coversLine: "I approve or reject each one in the browser",
    sourceFile: SOURCE_FILE,
    intent: "the review loop as four numbered beats",
    type: "process",
    status: "ready",
    htmlPath: "scenes/scene_09.html",
    exportPath: null,
    measuredDurationSec: 7.6,
    html: SCENE_09_HTML,
  },
]

export const MOCK_PROJECT: Project = {
  version: 1,
  id: "8f2c1a4e-4b0d-4f6a-9c31-2b7e5d0a1c93",
  path: "/Users/kristianvtr/Movies/broll-pipeline-video",
  name: "Building an AI b-roll pipeline",
  createdAt: "2026-07-24T10:00:00Z",
  fps: 30,
  media: [
    { path: "raw/a-cam-01.mp4", durationSec: 1840.2, hasAudio: true },
    { path: "raw/a-cam-02.mp4", durationSec: 962.7, hasAudio: true },
    { path: "raw/b-cam-overhead.mp4", durationSec: 1804.9, hasAudio: false },
  ],
  transcript: { words },
  spans,
  cleanupApprovedAt: "2026-07-31T09:52:00Z",
  styleGuide: {
    palette: ["#0B0B0F", "#E8E8ED", "#7C5CFF"],
    fontStack: "ui-sans-serif, system-ui, sans-serif",
    motion: "slow, heavy easing, opacity and scale only",
    notes: "dark, high contrast, generous whitespace",
  },
  scenes: SCENES,
  copy: {
    youtube: {
      title: [
        "I built an AI that decides where my b-roll goes",
        "The b-roll problem nobody talks about",
        "Word-level timestamps changed how I edit",
      ],
      description: `A local tool that reads an hour of raw footage, decides where b-roll would help, and generates the scenes as animated HTML — then exports them as ProRes with alpha so they overlay the footage instead of cutting away.

The core idea: the model never rewrites the transcript. It emits decisions on spans, so every downstream timestamp still points at a real moment in a real file.

Nothing uploads. Everything runs on localhost.`,
      chapters: [
        { timecode: "00:00", label: "The part of editing I'm bad at" },
        { timecode: "01:12", label: "Why word-level timestamps" },
        { timecode: "03:04", label: "Span decisions, not prose" },
        { timecode: "05:41", label: "Generating scenes as HTML" },
        { timecode: "08:20", label: "Frame-stepping the export" },
        { timecode: "11:05", label: "What actually ships" },
      ],
      tags: [
        "video editing",
        "ai workflow",
        "b-roll",
        "mastra",
        "ffmpeg",
        "playwright",
        "prores",
      ],
    },
    twitter: {
      hook: "I stopped asking the model to clean up my transcript. It only gets to say 'keep this range' or 'cut this range' now — and that one change made every downstream timestamp real.",
      thread: [
        "Ask an LLM to tidy a transcript and it hands back clean prose. Lovely. Also useless — that text no longer maps to any moment in any file.",
        "So the cleanup pass emits spans instead: { start, end, action, reason, category }. The 'clean script' in the UI is just the kept spans concatenated. Derived, never stored.",
        "Because the spans are anchored to real timecode, the next agent can say 'there's a 7 second gap at 04:12 that wants a diagram' and mean it literally.",
        "Scenes are self-contained HTML. All motion via CSS animations — no rAF, no Date.now. The exporter pauses everything and steps currentTime one frame at a time.",
        "Break that rule and the scene looks perfect in preview and renders frozen in the export. You find out three weeks and ninety scenes later.",
        "Output: ProRes 4444 with alpha, plus a text file telling me where each clip goes. That file sits on the second monitor while I cut. That's the whole product.",
      ],
      standalone:
        "The useful unit for AI in a video pipeline isn't text. It's a decision on a span of time. Text loses the timecode; spans keep it.",
    },
  },
}

export const MOCK_RUN: Run = {
  id: "run_01JQ8Z3M2K",
  status: "suspended",
  startedAt: "2026-07-31T09:41:00Z",
  suspendedOn: "review-scenes",
  steps: [
    {
      id: "scan",
      label: "Scan folder",
      status: "success",
      detail: "3 files · 1h 16m of footage",
      log: [
        "walking /Users/kristianvtr/Movies/broll-pipeline-video/raw",
        "raw/a-cam-01.mp4 — 1840.2s, audio",
        "raw/a-cam-02.mp4 — 962.7s, audio",
        "raw/b-cam-overhead.mp4 — 1804.9s, no audio",
      ],
    },
    {
      id: "extract-audio",
      label: "Extract audio",
      status: "success",
      detail: "2 wav files in tmp",
      log: [
        "ffmpeg -i raw/a-cam-01.mp4 -vn -ac 1 -ar 16000 …",
        "ffmpeg -i raw/a-cam-02.mp4 -vn -ac 1 -ar 16000 …",
        "skipped raw/b-cam-overhead.mp4 (no audio stream)",
      ],
    },
    {
      id: "transcribe",
      label: "Transcribe",
      status: "success",
      detail: `${words.length} words with timestamps`,
      log: [
        "verbose_json, timestamp_granularities: ['word']",
        `a-cam-01.wav → ${words.length} words`,
        "a-cam-02.wav → 0 words (silent take)",
      ],
    },
    {
      id: "cleanup",
      label: "Cleanup spans",
      status: "success",
      detail: `${spans.filter((s) => s.action === "cut").length} cuts proposed`,
      log: [
        "cleanupAgent — span decisions only, no prose",
        `${spans.length} spans returned`,
        "suspended for review-cleanup",
        "resumed — approved",
      ],
    },
    {
      id: "scenarios",
      label: "Place scenes",
      status: "success",
      detail: "6 placements",
      log: [
        "scenarioAgent reading approved script",
        "6 gaps identified, windows 5.5s–8.0s",
      ],
    },
    {
      id: "generate",
      label: "Generate scenes",
      status: "success",
      progress: 100,
      detail: "5 of 6 succeeded",
      log: [
        "foreach generateSceneWorkflow, concurrency 3",
        "scene_03 ok — 6.4s measured",
        "scene_04 ok — 5.5s measured",
        "scene_06 ok — 8.2s measured (overruns 7.0s window)",
        "scene_07 ok — 4.8s measured",
        "scene_08 failed — <canvas> in output, rejected",
        "scene_09 ok — 7.6s measured",
      ],
    },
    {
      id: "export",
      label: "Export ProRes",
      status: "suspended",
      progress: 33,
      detail: "waiting on scene approvals",
      log: [
        "concurrency 1 — exports run serialized",
        "scene_04.mov written (165 frames, 5.5s @ 30fps)",
      ],
    },
    { id: "copy", label: "Write copy", status: "pending", log: [] },
    { id: "shotlist", label: "Shot list", status: "pending", log: [] },
  ],
}

export const MOCK_PROJECTS: ProjectSummary[] = [
  {
    id: MOCK_PROJECT.id,
    name: MOCK_PROJECT.name,
    path: MOCK_PROJECT.path,
    createdAt: MOCK_PROJECT.createdAt,
    lastOpened: "2026-07-31T09:41:00Z",
    sceneCount: SCENES.length,
    exportedCount: SCENES.filter((s) => s.status === "exported").length,
    thumbnailHtml: SCENE_03_HTML,
  },
  {
    id: "b1a7c3d9-72f4-4a18-8e55-9f0c6d2b4e77",
    name: "Why your ffmpeg pipeline is slow",
    path: "/Users/kristianvtr/Movies/ffmpeg-deep-dive",
    createdAt: "2026-06-12T14:20:00Z",
    lastOpened: "2026-07-19T18:03:00Z",
    sceneCount: 9,
    exportedCount: 9,
    thumbnailHtml: SCENE_07_HTML,
  },
  {
    id: "c9e4f210-5d3b-4c6a-b8f1-3a2d7e9c0b45",
    name: "Local-first tools, one year on",
    path: "/Users/kristianvtr/Movies/local-first-retro",
    createdAt: "2026-07-29T08:15:00Z",
    lastOpened: "2026-07-30T21:47:00Z",
    sceneCount: 4,
    exportedCount: 0,
    thumbnailHtml: SCENE_09_HTML,
  },
  {
    id: "d3b8a170-9c25-4e73-9a04-6f1e8c5d2a31",
    name: "Shooting a talking head with one light",
    path: "/Users/kristianvtr/Movies/one-light-setup",
    createdAt: "2026-05-02T11:05:00Z",
    lastOpened: "2026-05-30T12:12:00Z",
    sceneCount: 0,
    exportedCount: 0,
    thumbnailHtml: null,
  },
]

/**
 * Stand-in for `/api/browse`. A local server can't open a native file dialog,
 * so the folder picker walks this tree instead (§10).
 */
const MOCK_TREE: Record<string, { name: string; hasProjectJson?: boolean }[]> = {
  "/Users/kristianvtr": [
    { name: "Movies" },
    { name: "Desktop" },
    { name: "Documents" },
    { name: "Programming" },
  ],
  "/Users/kristianvtr/Movies": [
    { name: "broll-pipeline-video", hasProjectJson: true },
    { name: "ffmpeg-deep-dive", hasProjectJson: true },
    { name: "local-first-retro", hasProjectJson: true },
    { name: "one-light-setup", hasProjectJson: true },
    { name: "unsorted-footage" },
    { name: "archive-2025" },
  ],
  "/Users/kristianvtr/Movies/unsorted-footage": [
    { name: "june" },
    { name: "july" },
  ],
  "/Users/kristianvtr/Movies/archive-2025": [{ name: "q4" }],
  "/Users/kristianvtr/Desktop": [{ name: "screen-recordings" }],
  "/Users/kristianvtr/Documents": [],
  "/Users/kristianvtr/Programming": [{ name: "video-production-workflow" }],
}

export function mockBrowse(path: string): DirListing {
  const children = MOCK_TREE[path] ?? []
  const parent = path === "/Users/kristianvtr" ? null : path.replace(/\/[^/]+$/, "")

  return {
    path,
    parent: parent && MOCK_TREE[parent] ? parent : null,
    entries: children.map((child) => ({
      name: child.name,
      path: `${path}/${child.name}`,
      hasProjectJson: child.hasProjectJson ?? false,
    })),
  }
}

export const MOCK_BROWSE_ROOT = "/Users/kristianvtr/Movies"
