# B-Roll Pipeline

A locally-run tool for video creators. Point it at a folder of raw footage; it
transcribes, marks up the transcript, decides where b-roll would help, generates
animated HTML scenes, and exports the approved ones as ProRes 4444 with alpha.

The full spec is in [idea.md](idea.md).

## Running it

```bash
cp .env.example .env.local   # OPENROUTER_API_KEY and OPENAI_API_KEY
npm run dev                  # the app, port 3000
npm run studio               # Mastra Studio, port 4111 — optional
```

Needs `ffmpeg` and `ffprobe` on PATH plus Playwright's Chromium
(`npx playwright install chromium`). The first step of every run checks all of
them and fails with an install message rather than halfway through.

Both processes share `~/.videotool/mastra.db`, so a run started in the app is
inspectable in Studio and vice versa.

```bash
npm test        # segment tiling, chunk offsets, scene validation
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
    whisper.ts                word timestamps, chunking, offsets
    render.ts                 Playwright frame-stepping and measurement
    validate-scene.ts         the §5 constraints, enforced
    ffmpeg.ts  preflight.ts  paths.ts  audio.ts  structured.ts
app/
  page.tsx                    projects list
  p/[id]/page.tsx             project view
  api/pipeline/route.ts       start and resume, both streaming
  api/projects  api/browse  api/reveal
components/
  project/                    header, pipeline progress, cleanup diff,
                              scene list, copy, style guide, shot list
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
tests/                        segments, whisper offsets, scene validation
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
- **Audio is extracted as mp3, not WAV** (§4.2). Whisper caps uploads at 25 MB
  and an hour of 16 kHz mono WAV is ~115 MB, so every long recording would need
  splitting; the same audio as mp3 is a tenth of that. Files still over the cap
  are split into ten-minute pieces with their word timestamps offset back.
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
