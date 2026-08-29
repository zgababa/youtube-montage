# B-Roll Pipeline — Build Spec

## 1. What this is

A **locally-run Next.js app** for video creators. You point it at a folder of raw footage. It transcribes everything, marks up the transcript, decides where b-roll would help, generates animated HTML scenes, and gives you a reviewable list of those scenes with timestamps telling you where each one goes in your edit.

Approved scenes export to ProRes `.mov` files with alpha. You cut the video yourself in your NLE.

Single user, runs on localhost, no auth, no deployment, no cloud storage.

## 2. What this is NOT

Read this section carefully — several obvious-seeming features are deliberately excluded.

- **Not a video editor.** No timeline, no trimming, no assembly.
- **No video playback in the browser at all.** No `<video>` element, no player, no proxies, no range-request media endpoint, no scrubbing of source footage. Source video files are inputs to ffmpeg and filenames in a list. They never reach the browser.
- **No cloud.** Nothing uploads. Files stay where they are.
- **No multi-user, no accounts, no sharing.**
- **Not a transcript editor.** The transcript is reviewed and approved, not hand-edited word by word (a later version may add this).

## 3. Core principle — span decisions, not rewriting

**The AI must never rewrite the transcript into new prose.**

The transcript is produced with **word-level timestamps**. The cleanup pass reads it and emits *decisions on spans* — it does not emit new text. Each decision is:

```json
{
  "start": 251.4,
  "end": 258.9,
  "action": "cut",
  "reason": "redundant with 04:12",
  "category": "redundant"
}
```

`action` is `keep` or `cut`. `category` is one of `filler`, `redundant`, `bad_take`, `tangent`, `false_start`.

The "clean script" shown in the UI is simply a **rendering of the spans marked `keep`**, concatenated in order. It is derived, never stored as authored text.

**Why this matters:** everything downstream — b-roll timestamps, scene placement, chapters, future cut suggestions — stays anchored to real timecode in the real source files. If the AI produces clean prose instead, that text no longer maps to any moment in any file, and the b-roll timestamps become meaningless.

## 4. Pipeline — a Mastra workflow

The entire pipeline is **one Mastra workflow** (`@mastra/core/workflows`). Each stage is a `createStep`. Steps that call models use Mastra agents; steps that shell out to ffmpeg or Playwright are plain deterministic steps. Mastra explicitly supports mixing both — use models where reasoning is needed and plain functions where it is not.

| # | Step id | Kind | Does | Writes |
|---|---------|------|------|--------|
| 1 | `scan` | plain | Walk project folder, find video/audio files, read durations via ffprobe | `media[]` |
| 2 | `extract-audio` | plain | ffmpeg audio only — `-vn -ac 1 -ar 16000` — never transcode video | wav files in tmp |
| 3 | `transcribe` | plain | STT with **word-level timestamps** (see §4.1) | `transcript` |
| 4 | `cleanup` | agent | `cleanupAgent` emits span decisions (see §3) | `spans[]` |
| — | **`suspend()`** | — | **Human approves the diff. Workflow suspends until resumed.** | `cleanupApprovedAt` |
| 5 | `scenarios` | agent | `scenarioAgent` reads approved script, decides where b-roll helps | `scenes[]` (metadata only) |
| 6 | `generate` | agent | `.foreach(generateSceneWorkflow, { concurrency: 3 })` — one nested run per scene | `scenes/scene_NN.html` |
| — | **`suspend()`** | — | **Human approves/rejects/regenerates scenes.** | `scene.status` |
| 7 | `export` | plain | Approved scenes only → Playwright frame-step → ffmpeg → ProRes | `exports/scene_NN.mov` |
| 8 | `copy` | agent | `copyAgent`: Twitter post + YouTube description, from the **approved** script | `copy` |
| 9 | `shotlist` | plain | Plain-text shot list | `shotlist.txt` |

Step 8 must use the approved script, not the raw transcript — otherwise the copy describes content that was cut.

Composition:

```typescript
export const brollWorkflow = createWorkflow({
  id: 'broll-pipeline',
  inputSchema: z.object({ projectPath: z.string() }),
  outputSchema: z.object({ exported: z.array(z.string()) }),
})
  .then(scanStep)
  .then(extractAudioStep)
  .then(transcribeStep)
  .then(cleanupStep)          // suspends for approval
  .then(scenariosStep)
  .foreach(generateSceneWorkflow, { concurrency: 3 })
  .then(reviewStep)           // suspends for approval
  .then(exportStep)
  .then(copyStep)
  .then(shotlistStep)
  .commit()
```

### 4.1 Word-level timestamps — do not use `voice.listen()`

**This is the one place Mastra does not fit the job.** Mastra's `voice.listen()` returns a plain transcript **string**. The whole architecture depends on word-level timestamps, so the `transcribe` step must call the STT provider directly inside a plain `createStep`:

- **OpenAI Whisper** — `response_format: 'verbose_json'` with `timestamp_granularities: ['word']`
- **Deepgram** — returns word-level timing natively, and is faster on long files
- **whisper.cpp / faster-whisper locally** — `--word_timestamps` / `word_timestamps=True`

Verify current Mastra STT capabilities before building — if `listen()` gains a timestamped return type, use it. Until then, treat transcription as a deterministic step wrapping the provider SDK, not as a Mastra voice call.

### 4.2 Human-in-the-loop via suspend/resume

The two checkpoints are **not** custom application state. They are Mastra `suspend()` calls inside a step, resumed with `run.resume({ resumeData })` when the user clicks approve in the UI. Mastra persists the snapshot, so an approval can arrive minutes or days later, across a server restart.

```typescript
const cleanupStep = createStep({
  id: 'cleanup',
  resumeSchema: z.object({ approved: z.boolean(), spans: z.array(SpanSchema) }),
  execute: async ({ inputData, resumeData, suspend, mastra }) => {
    if (resumeData) return { spans: resumeData.spans }
    const agent = mastra.getAgent('cleanupAgent')
    const spans = await proposeSpans(agent, inputData.transcript)
    return suspend({ spans, reason: 'review-cleanup' })
  },
})
```

This replaces what would otherwise be a hand-rolled job registry, a status enum, and a resume mechanism.

### 4.3 Progress

Use `run.stream()` rather than a custom job/SSE layer. Events emitted as steps complete are piped straight to the UI. `run.start()` is fine for the CLI when only the final result matters.

Mastra also restarts active runs automatically when the local server starts, and `restartAllActiveWorkflowRuns()` / `run.restart()` cover interrupted runs — so a crashed export resumes rather than starting over.

### 4.4 Agents

Registered on the Mastra instance, each with its own instructions:

- **`cleanupAgent`** — emits span decisions, never prose
- **`scenarioAgent`** — decides placements, intent, type, and available window per scene
- **`sceneAgent`** — writes one self-contained HTML scene; receives the style guide (§5) plus the scene's window and intent
- **`copyAgent`** — Twitter and YouTube copy

Scene generation is `.foreach()` over a nested per-scene workflow, not `.parallel()` — same operation over many inputs, with `concurrency` controlling fan-out. Keep concurrency modest (3) to stay inside model rate limits.

Handle failures **inside** each scene step with try/catch returning `{ html: null, failed: true }`. In Mastra, one throwing iteration fails the whole block — a single bad scene must not kill a run that generated eleven good ones.


## 5. Scene generation — hard constraints

These constraints go into the system prompt for the scene-generating agents. They are not stylistic preferences; the export pipeline depends on them.

### Motion timing (critical)

- **All motion via CSS animations or the Web Animations API.**
- **No `setTimeout`, no `setInterval`, no `requestAnimationFrame` timing loops, no `Date.now()`.**
- **No `<canvas>`, no Lottie, no video elements, no GIFs.**
- Every animated property must be reachable via `document.getAnimations()`.

**Why:** the exporter pauses all animations and sets `currentTime` frame by frame. Anything driven by JS wall-clock time will render **frozen** in the export while looking perfect in preview. This is also what makes the preview scrubber work. Retrofitting this later means regenerating every scene ever made.

### Output format

- One **self-contained HTML file**. All CSS in a `<style>` tag, no external requests, no CDN links, no imported fonts (system font stack only), no images unless inlined as data URIs.
- Transparent background — no `background` on `html`/`body`. Scenes are overlays by default.
- Designed for a **1920×1080** frame.

### Duration

Each scene is given an **available window** — the length of the gap in the script it fills. The scene's total animation duration must fit inside that window. This is passed into the generation prompt and validated after generation by reading the longest animation end time.

A scene animating 15s into a 7s gap is the single most likely everyday annoyance. Prevent it at generation time.

### Motion style

Rendered frames are instantaneous samples with **no motion blur**, so fast movement strobes against real camera footage. Instruct agents toward: slower moves, generous easing, prefer opacity/scale/blur over objects traversing the frame.

### Style guide

A single style guide object is passed to **every** scene agent — palette, typography, motion character, spacing. Without it, parallel agents produce visually inconsistent scenes. Stored in `project.json` under `styleGuide`, editable in the UI, customizable per project.

**Built, then unbuilt:** it was generated per project by its own agent and step. Both are gone. A transcript says what a video is about, not what it should look like, and a look invented per project means video three doesn't match video one — consistency across a channel is what the guide is for. The look is now a house default (`design.md`) that a project can override, and everything about it that never varies lives in `sceneAgent`'s prompt.

## 6. Export

```js
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 960, height: 540 },
  deviceScaleFactor: 2,          // → true 1920×1080
});
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => document.getAnimations().forEach(a => a.pause()));

const totalFrames = Math.ceil(durationSec * fps);
for (let f = 0; f < totalFrames; f++) {
  const t = (f / fps) * 1000;
  await page.evaluate(ms =>
    document.getAnimations().forEach(a => { a.currentTime = ms; }), t);
  await page.screenshot({
    path: `${tmp}/${String(f).padStart(5, "0")}.png`,
    omitBackground: true,        // preserves alpha
  });
}
```

Then:

```
ffmpeg -framerate 30 -i frames/%05d.png \
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le exports/scene_03.mov
```

Non-negotiable details:

- **`deviceScaleFactor: 2` with a 960×540 viewport.** Screenshotting a 1920-wide viewport at scale 1 gives correct dimensions but half the effective text density — subtly soft, hard to diagnose.
- **Await `document.fonts.ready`** before the first frame or opening frames render in a fallback font.
- **`omitBackground: true`** → PNGs with alpha → ProRes 4444 → scenes overlay footage instead of only cutting away.
- **fps is a project setting** and must match the user's timeline fps (default 30). Mismatch causes judder.
- Frame PNGs go to `os.tmpdir()`, deleted after encoding.
- **Exports run serialized, concurrency 1.** Four concurrent Playwright+ffmpeg jobs makes the machine unusable.

## 7. Data model

`project.json` lives **inside the project folder** and is the source of truth. Projects are portable by moving a folder.

```json
{
  "version": 1,
  "name": "Building an AI b-roll pipeline",
  "createdAt": "2026-07-31T10:00:00Z",
  "fps": 30,
  "media": [
    { "path": "raw/a-cam-01.mp4", "durationSec": 1840.2, "hasAudio": true }
  ],
  "transcript": {
    "words": [
      { "w": "so", "start": 12.10, "end": 12.28, "file": "raw/a-cam-01.mp4" }
    ]
  },
  "spans": [
    { "start": 251.4, "end": 258.9, "action": "cut",
      "reason": "redundant with 04:12", "category": "redundant" }
  ],
  "cleanupApprovedAt": "2026-07-31T11:02:00Z",
  "styleGuide": {
    "palette": ["#0B0B0F", "#E8E8ED", "#7C5CFF"],
    "fontStack": "ui-sans-serif, system-ui, sans-serif",
    "motion": "slow, heavy easing, opacity and scale only",
    "notes": "dark, high contrast, generous whitespace"
  },
  "scenes": [
    {
      "id": "scene_03",
      "scriptStart": 252.0,
      "scriptEnd": 259.0,
      "windowSec": 7.0,
      "coversLine": "the agent picks up the job from the queue",
      "sourceFile": "raw/a-cam-01.mp4",
      "intent": "diagram of the job queue, replaces the hand-wave",
      "type": "diagram",
      "status": "approved",
      "htmlPath": "scenes/scene_03.html",
      "exportPath": "exports/scene_03.mov",
      "measuredDurationSec": 6.4
    }
  ],
  "copy": {
    "youtube": { "title": [], "description": "", "chapters": [], "tags": [] },
    "twitter": { "hook": "", "thread": [], "standalone": "" }
  }
}
```

`scene.status` ∈ `pending | generating | ready | approved | rejected | exporting | exported | failed`.
`scene.type` ∈ `diagram | code | data | process | concept` — different types have different generation prompts and different success rates.

### Projects index

`~/.videotool/projects.json` — a **disposable** index, nothing important in it:

```json
{ "projects": [
  { "id": "uuid", "path": "/Users/me/vids/broll-tool", "lastOpened": "..." }
]}
```

On launch, drop entries whose folders no longer exist. Rebuildable by re-adding folders.

## 8. File layout

### Project folder (user's, durable)
```
my-video/
  raw/                    source footage (read-only, never modified)
  project.json            source of truth
  scenes/scene_03.html    generated scenes
  exports/scene_03.mov    rendered ProRes
  shotlist.txt            plain text, for the second monitor
  review.html             optional standalone export of the review page
```

### App
```
src/mastra/
  index.ts                       Mastra instance: agents, workflows, storage
  agents/
    cleanup-agent.ts  scenario-agent.ts
    scene-agent.ts    copy-agent.ts
  workflows/
    broll-workflow.ts            the pipeline (§4)
    generate-scene-workflow.ts   nested per-scene workflow
  steps/
    scan.ts  extract-audio.ts  transcribe.ts
    export.ts  shotlist.ts      deterministic, no model calls
  lib/
    project.ts                   project.json read/write
    render.ts                    Playwright frame-stepping
app/
  page.tsx                       projects list
  p/[id]/page.tsx                project view
  api/projects/route.ts          GET list, POST add by path
  api/projects/[id]/route.ts     GET project.json
  api/runs/route.ts              POST start a workflow run
  api/runs/[id]/route.ts         POST resume (approval), GET status
  api/browse/route.ts            GET dir listing, for the folder picker
  api/reveal/route.ts            POST — `open -R` on a path
```

**`src/mastra/` must have zero Next imports.** The workflow has to run headless — from `bunx mastra dev` Studio, from `bunx mastra api workflow run start`, and from a plain script. This is how the renderer gets debugged; clicking through a browser to test frame-stepping is miserable.

Frame PNGs and extracted audio go to `os.tmpdir()` — **never** inside the project directory, or the dev server watches thousands of PNGs and falls over.

## 9. Runtime — Mastra + Next.js

Two processes during development:

- **Mastra server** — `bunx mastra dev`, port 4111. Runs the workflow, hosts Studio.
- **Next.js** — port 3000. The UI, and thin API routes that call the workflow.

Next routes talk to Mastra through `mastra.getWorkflow('brollWorkflow')` (preferred over a direct import — it carries the instance's logger, storage, telemetry, and registered agents, and gives full type inference on input/output schemas). Consult Mastra's "With Next.js" integration docs for whether to embed the instance in-process or call the server over HTTP with `MastraClient`; either works locally, and in-process is fewer moving parts.

Every route touching ffmpeg, Playwright, or `fs`:

```ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
```

### What Mastra replaces

Do **not** hand-roll any of the following — Mastra provides each, and duplicating them creates two competing sources of truth:

| Don't build | Use instead |
|---|---|
| Job registry pinned to `globalThis` | Mastra run storage |
| Custom status enum and progress polling | `run.stream()` events |
| Approval flags plus a resume mechanism | `suspend()` / `run.resume()` |
| Crash recovery and "which step was I on" | Snapshots, `run.restart()`, auto-restart of active runs on server start |
| Step retry and error bookkeeping | Workflow error handling |

### Storage

Mastra needs a storage adapter for run persistence — **LibSQL to a local file** is the right choice here. Point it somewhere stable outside the Next project (`~/.videotool/mastra.db`), not at a project folder.

This creates a **split**, and it must be deliberate:

- **Mastra storage** owns *run* state — which step is executing, suspended payloads, snapshots. Disposable; losing it costs a re-run.
- **`project.json`** owns *deliverable* state — transcript, spans, scenes, copy. Portable; moving the folder moves the work.

Every step that produces deliverable data writes it into `project.json` before returning. Workflow state is for passing values between steps, not for storing the result.

### Studio

`bunx mastra dev` gives a graph view of the pipeline, live per-step status, a generated input form, execution traces, and time travel to replay an individual step after a run.

This is the debugging surface for the whole build. Re-running just the `scenarios` step against an existing transcript — without re-transcribing an hour of footage — is what makes iteration on prompts tolerable. Use Studio before building any custom progress UI.

## 10. UI

Three screens. Plain and functional; this is a tool, not a product.

### Components — shadcn/ui only

**All UI components must come from shadcn/ui.** No other component library, no hand-rolled equivalents of components shadcn already provides, no Material UI, Chakra, Mantine, Radix used directly, or bespoke button/dialog/input implementations.

- Install via the CLI (`bunx shadcn@latest add <component>`) so components land in `components/ui/` as owned source.
- Tailwind for layout and spacing around those components; do not restyle them into something unrecognisable.
- If a needed component isn't in shadcn, compose it from shadcn primitives before writing anything custom.

Expected components: `card`, `button`, `badge`, `dialog`, `input`, `textarea`, `select`, `slider`, `tabs`, `scroll-area`, `separator`, `progress`, `skeleton`, `collapsible`, `tooltip`, `sonner` (toasts), `alert`.

The one deliberate exception is the scene preview `<iframe>`, which is raw by necessity — wrap it in a shadcn `Card`, but the iframe itself stays a plain element.

### Projects list
Grid of `Card` components: name, date, `12 scenes · 4 exported`, thumbnail. Thumbnail = Playwright screenshot of the first scene at its midpoint (free, Playwright is already there). Add a project by folder path — an `Input` plus a simple browser backed by `/api/browse` in a `Dialog`, since a local server can't open a native file dialog.

### Project view
Header: project name, fps, step status, run buttons.

**Transcript/cleanup section** — the diff. Kept text normal, cut text struck through and dimmed, grouped by category with counts (`filler: 82`, `redundant: 6`, `bad_take: 3`). Toggle to hide cuts. An **Approve cleanup** button gates steps 5+.

Watch for the failure mode: cleanup sanding off deliberate repetition, callbacks, and pauses. The diff exists so the user catches it.

**Scene list** — sorted by timestamp, reading top-to-bottom as a shot list. Each row:

- `04:12 → 04:19 (7s)` and measured animation duration, flagged red if it overruns the window
- **the script line it covers, verbatim** — this is what gets scanned while editing, more than the timestamp
- live preview in a sandboxed iframe
- one-line intent, scene type badge, source file
- approve / reject / regenerate-with-note / export

Previews are **not served as files**. Read the HTML server-side, pass the string, drop it in `srcDoc`:

```jsx
<iframe sandbox="allow-scripts" srcDoc={scene.html} />
```

`allow-scripts` **without** `allow-same-origin` — generated code must not be able to touch the app.

Include a replay button (swap `srcDoc` to restart) and a scrub slider driving `document.getAnimations()` on the iframe's document.

**Copy section** — YouTube title options, description, chapters, tags; Twitter hook tweet, thread, standalone insight tweet. Each with a copy button.

### Job progress
Inline per-step: spinner, percentage, current file, a collapsible log. Cancel where feasible.

## 11. Output

For each approved scene: a ProRes 4444 `.mov` with alpha, plus `shotlist.txt` —

```
04:12  7.0s  scene_03.mov  "the agent picks up the job from the queue"
05:48  5.5s  scene_04.mov  "three passes run in parallel"
```

That's what sits on the second monitor during the edit.

## 12. Explicitly deferred

Do not build these. They're all reasonable and none is needed to find out whether this works.

- FCPXML / OTIO / EDL export to drop scenes onto an NLE timeline automatically
- Cut suggestions as a user-facing feature (the span data already supports it)
- Multi-take clustering — group near-identical retakes, score, pick best
- Coverage gaps — detect "as you can see here" with no matching footage
- Short-form clip extraction
- Captions (SRT/VTT)
- Terminology consistency checking
- Hook-specific analysis of the first 30 seconds
- Tauri wrapper for a native app feel

## 13. Build order

**Workflow in Studio before any UI.** `bunx mastra dev` gives a graph view, an input form, live status, and time travel — a better debugging surface than a hand-rolled CLI, and it exists on day one.

```
bunx mastra dev
bunx mastra api workflow run start broll-pipeline '{"inputData":{"projectPath":"/path/to/project"}}'
```

Run it on one real folder until it goes from raw files to `.mov` files and a shot list untouched. The real bugs live here — timestamp drift between STT output and span decisions, scenes referencing the wrong script line, duration mismatches. Use Studio's time travel to re-run a single step against an existing transcript rather than re-transcribing an hour of footage each iteration.

Then:

1. **Workflow end-to-end, driven from Studio** ← the actual build
2. **Project view** — scene list, previews, approve/reject wired to `run.resume()`
3. **Projects list + run progress** — the part that makes it an app
4. **Copy pass** — Twitter and YouTube

Milestone 2 is already usable.

## 14. Stack

**AI layer — Mastra, for everything model-related and all orchestration.**

- `@mastra/core` — agents, workflows (`createStep`, `createWorkflow`), suspend/resume
- `mastra` CLI — `bunx mastra dev` for Studio on port 4111
- `@mastra/libsql` — local run storage at `~/.videotool/mastra.db`
- Zod for all step input/output schemas
- Mastra's model router for provider access — model strings in `provider/model` form (e.g. `anthropic/claude-opus-5`), defined as strings, not imported provider objects

**App layer**

- Next.js (App Router), TypeScript, run locally via `bun run dev`
- Node 20+, `"type": "module"`
- **shadcn/ui for every UI component** (§10) — Tailwind CSS, components installed via `bunx shadcn@latest add`, living in `components/ui/`. No other component library.

**Media layer — outside Mastra, plain deterministic steps**

- ffmpeg + ffprobe on PATH — check at startup, show a clear install message if missing
- Playwright (Chromium) for frame-stepped export
- STT provider SDK called directly for word-level timestamps (§4.1) — **not** `voice.listen()`

**Storage**

- `project.json` per project folder — the deliverable, portable
- LibSQL file for Mastra run state — disposable
- No application database beyond those two

### Setup

`bun create mastra@latest` scaffolds the project and installs Mastra's skills for coding assistants. Worth running `bunx skills add mastra-ai/skills --skill mastra` so the generating AI has current Mastra API guidance rather than working from training data — the workflow API has changed shape (there is a separate legacy workflows namespace in the docs; ignore it and use `@mastra/core/workflows`).
