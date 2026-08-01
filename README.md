# B-Roll Pipeline

A locally-run tool for video creators. Point it at a folder of raw footage; it
transcribes, marks up the transcript, decides where b-roll would help, generates
animated HTML scenes, and exports the approved ones as ProRes 4444 with alpha.

The full spec is in [idea.md](idea.md).

## Running it

```bash
cp .env.example .env.local   # OPENROUTER_API_KEY and ASSEMBLYAI_API_KEY
npm run dev                  # the app, port 3000
npm run studio               # Mastra Studio, port 4111 — optional
```

Needs `ffmpeg` and `ffprobe` on PATH plus Playwright's Chromium
(`npx playwright install chromium`). The first step of every run checks all of
them and fails with an install message rather than halfway through.

Both processes share `~/.videotool/mastra.db`, so a run started in the app is
inspectable in Studio and vice versa.

```bash
npm test        # segment tiling, transcript units, media roles, scene validation
npm run lint
npm run typecheck
```

## How the pipeline works

One Mastra workflow, eleven steps, two human gates:

```
scan → extract-audio → transcribe → cleanup ⏸ → style-guide → scenarios
     → generate ×3 → review ⏸ → export → copy → shotlist
```

The gates are Mastra `suspend()` calls resumed with `run.resume()`, not
application state — so an approval can arrive days later, across a server
restart.

**Storage is split on purpose.** `project.json` inside the project folder owns
the deliverables (transcript, spans, scenes, copy) and is portable; moving the
folder moves the work. `~/.videotool/mastra.db` owns run state and is
disposable — losing it costs a re-run. Every step writes to `project.json`
before returning, which is why a lost stream costs nothing but the progress bar.

### Two recorders, one transcript

The ordinary shooting setup records the same speech twice — a camera capturing
its own scratch audio, and a separate mic or recorder capturing the good audio.
Both are media, both have sound, and transcribing both puts the whole talk into
the script twice.

So each file carries three settings, on the project's **Media** tab:

| | |
|---|---|
| `transcribe` | whether this file's audio is sent to the transcriber |
| `voices` | the clip this file is the audio *for* |
| `offsetSec` | seconds added to its word timings to land on that clip's clock |

`scan` fills them in when the reading is unambiguous — exactly one standalone
audio file and exactly one video with sound gets paired automatically, mic as
the source and camera as the anchor. Anything more ambiguous transcribes
everything and flags the Media tab, because pairing the wrong two files produces
a result that still looks plausible.

`voices` is what keeps the shot list useful: words from the mic are re-tagged
with the camera clip, so a scene tells you to scrub the file actually on your
timeline rather than an mp3. `offsetSec` is the one thing nothing can infer —
sync in your NLE, read the delta, type it in. A mic that rolled 8.2s before the
camera is `-8.2`. Settings survive a re-scan, and a run warns if the offset
pushes words before 00:00.

A screen recording that captured its own audio needs none of this: one file,
one clock, `voices: null`.

### The AI never rewrites the transcript

The cleanup agent never sees raw word timings and never emits prose. Words are
grouped into numbered segments, the agent returns *cuts by segment index*, and
[`src/mastra/lib/segments.ts`](src/mastra/lib/segments.ts) converts those back to
exact times and fills every gap with `keep` spans. Keeps are derived, never
asked for — that's what guarantees the spans tile the transcript with nothing
missing, since the clean script is just the kept spans concatenated.

### Streaming, end to end typed

[`src/mastra/stream/contract.ts`](src/mastra/stream/contract.ts) declares every
event once. `PipelineDataParts` feeds `useChat<PipelineUIMessage>` on the
client; `emitter()` keys into the same object on the writing side. Since AI SDK
derives `part.type` from `data-${key}`, a step emitting `data-scene` and a
component reading `part.data` are checked against one definition — and a Zod
`.parse()` inside `emit` covers the one hop TypeScript can't see through
(Mastra's `writer.custom(chunk: unknown)`).

[`lib/run-reducer.ts`](lib/run-reducer.ts) folds the stream back into `Project`
and `Run`, so every component predates the pipeline and none of them changed
when it landed.

## Layout

`src/mastra/` has **zero Next imports** — the workflow has to run headless from
Studio and from a plain script, which is how the renderer gets debugged.

```
src/mastra/
  index.ts                    the instance: agents, workflows, LibSQL storage
  schemas.ts                  project.json as Zod — the single source of truth
  models.ts                   openrouter/anthropic/* ids
  stream/contract.ts          every event, once; the typed emitter
  agents/                     cleanup, style, scenario, scene, copy
  workflows/                  broll-workflow, generate-scene-workflow
  steps/                      one file per step
  lib/
    project.ts                project.json read/modify/write, atomic + queued
    segments.ts               words ↔ segments ↔ spans
    media.ts                  transcription sources, pairing, sync offsets
    stt.ts                    AssemblyAI word timestamps, ms → seconds
    render.ts                 Playwright frame-stepping and measurement
    validate-scene.ts         the §5 constraints, enforced
    ffmpeg.ts  preflight.ts  paths.ts  audio.ts  structured.ts
app/
  page.tsx                    projects list
  p/[id]/page.tsx             project view
  api/pipeline/route.ts       start and resume, both streaming
  api/projects/[id]/route.ts  PATCH media roles, fps, style guide
  api/projects  api/browse  api/reveal
components/
  project/                    header, pipeline progress, media settings,
                              cleanup diff, scene list, copy, style guide,
                              shot list
  projects/                   browser (list/card views), row, card,
                              thumbnail, add-project dialog
  scene/scene-frame.tsx       the sandboxed preview iframe
  search-input.tsx            shared search field
  highlight.tsx               wraps matches without altering the text
  ui/                         shadcn components (owned source)
hooks/use-pipeline.ts         useChat over the workflow
lib/
  types.ts                    re-exports the inferred schema types
  api.ts                      server-only reads
  client-api.ts               browse, add, reveal
  run-reducer.ts              stream parts → Project and Run
  project.ts                  derivations — clean script, shot list, counts
  scene-controller.ts         postMessage scrubber injected into previews
tests/                        segments, transcript units, media roles,
                              scene validation
```

## Projects list

Two views, toggled top-right and remembered in localStorage:

- **List** (default) — one row per project: small thumbnail, name, folder path,
  counts and last-opened on the right. Scans quickly down a column.
- **Cards** — the same data as a thumbnail-led grid, 4 across at `xl`.

## Search

Three places, all client-side over data already loaded:

- **Projects grid** — name and folder path.
- **Scene list** — the covered script line first, plus intent, scene id, type,
  source file, and the last regenerate note.
- **Transcript** — narrows the cleanup diff to the spans containing the phrase,
  in script order. Matches are highlighted; the words themselves are untouched,
  and toggling a cut still edits the right span in `project.spans`.

## Scene previews

Scene HTML is never served as a file. It is read server-side, passed as a
string, and dropped into a sandboxed iframe:

```jsx
<iframe sandbox="allow-scripts" srcDoc={html} />
```

`allow-scripts` **without** `allow-same-origin` — generated code must not be
able to reach the app. That also means the page can't touch the iframe's
document, so the scrubber is a small controller injected alongside the scene
([`lib/scene-controller.ts`](lib/scene-controller.ts)) that drives
`document.getAnimations()` over `postMessage` — the same thing the exporter does
when it frame-steps.

A scene that scrubs correctly here is a scene that exports correctly. One that
uses `setTimeout` or `requestAnimationFrame` for timing will look right in
preview and render frozen in the export; the scrubber is what surfaces that.

Previews are mounted only while on screen. A scene preview is a live 1920×1080
document, and a dozen of them at once is enough to stall the compositor.

## Where this departs from the spec

Three deliberate deviations from [idea.md](idea.md), all found while building:

- **Export viewport is 1920×1080 at scale 1**, not 960×540 at
  `deviceScaleFactor: 2` (§6). §5 tells the scene agent to design for 1920×1080,
  and in a 960 CSS viewport such a scene renders only its top-left quarter while
  `100vw` covers half the frame. The two sections can't both hold; authoring
  space wins. The density concern §6 raises was about upscaling a 960-wide
  design, which is no longer what happens.
- **Audio is extracted as mp3, not WAV** (§4.2). §4.2 asks for WAV, but the only
  thing the file is used for is a single upload, and mp3 is a tenth the size at
  no cost to transcription accuracy. On an hour of footage that is ~115 MB
  against ~11 MB, entirely in upload time.
- **Transcription is AssemblyAI, not Whisper** (§4.1). §4.1 names Whisper first
  of three candidates and asks for the provider to be verified before building;
  `universal-3-5-pro` is more accurate, returns word timings without a flag, and
  takes 5 GB per job rather than 25 MB — which removed the chunk-and-offset step
  the Whisper path needed entirely. It does mean
  `disfluencies: true` is mandatory: AssemblyAI strips "um" and "uh" by default,
  and cutting exactly those is half of what step 4 does.
- **A `style-guide` step was added.** §5 requires one guide shared by every
  scene agent but the §4 step table omits it. Giving it its own step means it
  can be re-run from Studio to try a different look without regenerating scenes.

## Components

All UI comes from shadcn/ui, installed via the CLI into `components/ui/`. This
project uses the **Base UI** primitives (`render`, not `asChild`) and
**hugeicons**. The one deliberate exception is the scene preview `<iframe>`.

```bash
npx shadcn@latest add <component>
```
