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

One Mastra workflow, ten steps, two human gates:

```
scan → extract-audio → transcribe → cleanup ⏸ → scenarios
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

### Big source files never leave the machine

Step 2 pulls mono 16 kHz mp3 out of each transcription source with
`ffmpeg -vn`, and only that goes to AssemblyAI. Measured on an 11 GB camera
file: **3.8 MB out**, identical duration, ~3 minutes at 1% CPU — the cost is
reading the source, not transcoding it, since `-vn` drops the video stream and
ffmpeg is just demuxing.

That read is why extraction is cached in `os.tmpdir()` and skipped when the
existing mp3 is newer than its source. Re-running the pipeline is the normal
way to iterate on prompts (idea.md §9), and without the check a 40 GB shoot
would pay ten minutes of disk on every single run. A zero-byte output counts as
a miss — that's a previous run that died mid-extract, and reusing it would send
silence to the transcriber.

### Recording in numbered segments

Several recordings become one script, and nothing in a file knows when it was
shot — container timestamps are the export, not the take. So the order comes
from the filename: prefix them `01 - `, `02 - ` and they stitch together that
way. The project's **Media** tab shows the resulting order before anything runs.

Two details make the convention hold, both of which the obvious implementation
gets wrong:

- **Numeric collation**, so `9` sorts before `10`. Plain string comparison puts
  `10 - ` first — the classic way a numbered sequence silently reorders itself
  on its tenth entry.
- **Filename before folder**, so `screen/03 - demo` slots between
  `raw/02 - problem` and `raw/09 - nine`. Comparing whole paths lets the
  directory outrank the number that was actually typed.

Unnumbered files fall back to name order, which is a guess — there's no other
signal to use.

### Telling the transcriber what it's listening to

Every asset the pipeline produces is a rewrite of the transcript, so a
transcription error doesn't stay one — a library name heard wrong comes back as
a confident misspelling in the b-roll briefs, the YouTube description and the
thread alike. `universal-3-5-pro` takes two hints that fix it at the source,
both on the project's **Media** tab:

- **What this is about** (`prompt`) — a sentence or two of context. Describes
  the recording, not how to transcribe it; formatting and behavioural
  instructions are ignored, and the model stays grounded in the audio, so
  context can't invent words.
- **Names and terms** (`keyterms_prompt`) — exact spellings to prefer. Up to
  ~1000 words total, 6 per phrase; the app refuses a longer list rather than
  letting terms past the limit silently stop working.

Both are omitted from the request when empty rather than sent blank.

### Two recorders, one transcript

The ordinary shooting setup records the same speech twice — a camera capturing
its own scratch audio, and a separate mic or recorder capturing the good audio.
Both are media, both have sound, and transcribing both puts the whole talk into
the script twice.

So each file carries three settings, under **Footage & transcript**:

| | |
|---|---|
| `transcribe` | whether this file's audio is sent to the transcriber |
| `voices` | the clip this file is the audio *for* |
| `offsetSec` | seconds added to its word timings to land on that clip's clock |

`scan` fills them in when the reading is unambiguous — exactly one standalone
audio file and exactly one video with sound gets paired automatically, mic as
the source and camera as the anchor. Pairing the wrong two files produces a
result that still looks plausible, so anything more ambiguous is left alone
rather than guessed at.

Failing that, **the filenames decide**. A folder with some files numbered
`01`, `02` and some not is making a statement: the numbered ones are the script
and the rest is footage. Only the numbered files are transcribed. This is the
same convention that sets script order, read as a second claim, and it's what
keeps a screen recording of the same take — or an unrelated audio file that
happened to be in the folder — out of the transcript. A folder that numbers
nothing, or numbers everything, transcribes every file with sound as before.

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
  agents/                     cleanup, scenario, scene, copy
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
  api/projects/[id]/route.ts  PATCH media roles, hints, fps, style guide
  api/projects  api/browse  api/reveal
components/
  project/                    header, run strip, stages, transcription hints,
                              media settings, cleanup diff, scene grid, copy,
                              style guide, shot list
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
                              audio caching, scene validation
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
- **The style guide is a house style, not a generated one.** §5 requires one
  guide shared by every scene agent, and it briefly had an agent and a step of
  its own. Both are gone: a transcript says what a video is about, not what it
  should look like, and generating the look per project means video three
  doesn't match video one. The guide is now a default in `design.md`, overridable
  per project in the UI, and everything that never varies moved into
  `sceneAgent`'s prompt.

## Components

All UI comes from shadcn/ui, installed via the CLI into `components/ui/`. This
project uses the **Base UI** primitives (`render`, not `asChild`) and
**hugeicons**. The one deliberate exception is the scene preview `<iframe>`.

```bash
npx shadcn@latest add <component>
```
