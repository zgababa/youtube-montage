# How this works, and why it's built this way

A complete walkthrough of the b-roll pipeline: the problem, the one idea the
whole thing rests on, every step in order, and the decisions that turned out to
matter. [README.md](README.md) is the short version and [idea.md](idea.md) is
the original spec — this is the long explanation of both, including the parts
where the spec turned out to be wrong.

---

## 1. The problem

A talking-head video is mostly someone explaining something. The explanation is
fine; the picture is a person's face for eleven minutes. B-roll is the fix —
cut away to something that shows what's being described — and it is the single
most expensive part of the edit:

- You have to notice the moment. Somewhere around 04:12 you said "the agent
  picks up the job from the queue" and waved your hands at nothing.
- You have to make the thing. A diagram, an animation, a code reveal.
- You have to make it fit. Seven seconds, not fifteen, or it runs over the next
  point.
- You have to make twelve of them look like they came from the same video.

Every one of those is mechanical, and none of them is why you started making
videos. This tool does all four, and stops exactly where taste starts: it hands
you a folder of `.mov` files and a text file telling you where each one goes.
**You still cut the video.**

### What it deliberately isn't

This matters as much as what it is, because several obvious features are
excluded on purpose:

- **Not a video editor.** No timeline, no trimming, no assembly.
- **No video playback in the browser at all.** No `<video>` element, no player,
  no proxies, no scrubbing of source footage. Source files are inputs to ffmpeg
  and filenames in a list — they never reach the browser.
- **Not a transcript editor.** The transcript is reviewed and approved, not
  hand-edited word by word.
- **No cloud, no accounts, no sharing.** It runs on localhost. The 40 GB of
  footage stays in the folder it's already in.

Each exclusion buys something. No playback means no media server, no proxy
generation, no range requests, no player state — which is most of what a video
tool normally is.

---

## 2. The one idea: decisions on spans, never new prose

This is the load-bearing constraint. Everything else follows from it.

The transcript comes back with **word-level timestamps** — every word knows when
it was said and which file it came from. The cleanup pass then reads it and
returns _decisions about ranges_:

```json
{
  "start": 251.4,
  "end": 258.9,
  "action": "cut",
  "reason": "redundant with 04:12",
  "category": "redundant"
}
```

The "clean script" you see in the UI is not a document anyone wrote. It's the
spans marked `keep`, concatenated, rendered on the fly.

**Why it has to work this way:** the moment an AI hands back tidied prose,
that text no longer maps to any moment in any file. "The agent picks up the job
from the queue" becomes a sentence rather than a timecode, and the b-roll that
belongs at 04:12 has nothing to attach to. Cut suggestions, chapter marks, scene
placement, the shot list — all of them are ultimately a pair of numbers that
traces back to a real word in a real file. Break the anchor and every downstream
feature becomes a guess.

So the rule is absolute: **the AI never rewrites the transcript.**

### How the constraint survives contact with a model

The naive way to honour it is to hand the model the word array and ask for
`{start, end}` floats back. That fails twice over:

1. **Token cost.** An hour of speech is roughly 9,000 words, and word-level JSON
   costs about ten times the tokens of the same text as prose.
2. **Invention.** A model asked to echo thousands of precise decimals will
   eventually produce one that was never in the input — which is exactly the
   failure the rule exists to prevent.

So the model never sees a timestamp. Words are grouped into **numbered
segments** — split on pauses of 0.6s or more, capped at 12 seconds — and the
model is shown this:

```
[0] 00:00 so today I want to talk about
[1] 00:04 um, about how the pipeline works
[2] 00:09 how the pipeline actually works
```

It returns `{ from: 1, to: 1, category: "filler" }`. Integers, not floats. The
arithmetic back to seconds happens in
[`src/mastra/lib/segments.ts`](src/mastra/lib/segments.ts), deterministically,
where it can be tested.

There's a second, subtler rule in the same file: **the model is only ever asked
what to cut.** Keeps are derived by filling the gaps between cuts. If you asked
for both, a model could quietly omit a stretch it forgot to mention, and since
the clean script is nothing but the kept spans concatenated, a paragraph of the
talk would vanish with no error anywhere. Deriving keeps makes it impossible for
the spans not to tile the transcript.

---

## 3. The shape of the system

Eleven steps, each one a direct, one-shot action the UI calls and streams
progress from — there is no single run connecting them, and nothing suspends:

```
scan → extract-audio → transcribe → cleanup ⏸ → fcpxml → scenarios
     → generate ×3 → review ⏸ → export → copy → shotlist
```

Steps that need judgement call an agent ([Mastra](https://mastra.ai)'s `Agent`
class, streamed structured output). Steps that shell out to ffmpeg or drive a
browser are plain async functions. Every one of them lives in
`src/mastra/steps/*.ts` and is callable on its own — `app/api/pipeline/route.ts`
is the one thing that calls them, one action at a time, over a stream built on
the same AI SDK primitive Mastra's own workflow runner uses internally.

### One store

`project.json`, inside the project folder, owns everything a step produces —
transcript, spans, scenes, copy, the editing document — and is portable: move
the folder and the work moves with it. Every step writes its results there
_before_ it returns. That single discipline is why the live progress stream
can be dropped at any moment — closing the tab, restarting the server, losing
the connection — and cost nothing but the ticking progress bar.

`project.json` is validated by Zod on every read and written atomically
(temp file, then rename) through a per-project promise queue, because scene
generation runs three at a time and three concurrent read-modify-writes to one
file would lose two of them.

### The two gates are not application state either

The cleanup approval and the scene review are plain writes to `project.json` —
whatever's on screen when the user clicks Approve, sent as one direct call. An
approval can arrive minutes or days later, across a server restart, because
there was never a run parked anywhere waiting for it.

This is why there is no job registry in this codebase, no status enum, and no
"which step was I on" recovery logic: the only thing worth recovering,
`project.json`, is already sitting on disk.

---

## 4. The pipeline, step by step

### Step 0 — preflight

Before anything else runs, the first step checks that `ffmpeg`, `ffprobe` and
Playwright's Chromium are actually present, and fails with an install message.
Finding out about a missing ffmpeg _after_ twenty minutes of transcription is a
bad afternoon.

### Step 1 — `scan`: what's in the folder

Walks the project folder, finds media by extension, probes each file with
`ffprobe` for duration and whether it has an audio track. Skips `scenes/`,
`exports/` and `node_modules/` — those are our own output, and walking them
would find our own exports.

It also creates `project.json` if there isn't one, which is what lets `scan`
be pointed at a bare folder of footage from a plain script, with no UI
involved.

Then it does the interesting part: **deciding which files are the script and
which are just footage.**

#### Two recorders, one transcript

The ordinary shooting setup records the same speech twice — a camera capturing
its own scratch audio, and a separate mic capturing the good audio. Both are
media, both have sound, and transcribing both puts the entire talk into the
script twice. That failure is _quiet_: the transcript reads as if the speaker
repeated themselves, the cleanup agent marks every filler twice, and scenes come
back pointing at the same moment through two different clocks.

Each file therefore carries three settings:

|              |                                                                |
| ------------ | -------------------------------------------------------------- |
| `transcribe` | whether this file's audio goes to the transcriber              |
| `voices`     | the clip this file is the audio _for_                          |
| `offsetSec`  | seconds added to its word timings to land on that clip's clock |

The rules that fill them in, in precedence order:

1. **A prior user setting always wins.** Re-scanning never overwrites a decision
   someone made in the UI.
2. **No audio track** → not a source, obviously.
3. **Unambiguous pairing** → exactly one standalone audio file and exactly one
   video with sound gets paired automatically: mic as the source, camera as the
   anchor. Anything more ambiguous is left alone rather than guessed at, because
   pairing the wrong two files produces a result that still looks plausible.
4. **The filenames decide.** A folder where _some_ files are numbered `01`,
   `02` and some aren't is making a statement: the numbered ones are the script,
   the rest is footage. Only the numbered files are transcribed. A folder that
   numbers nothing, or numbers everything, transcribes every file with sound.

Rule 4 came from a real folder: `01.MP4`, `02.MP4`, `Helium.mp4` (a screen
recording of the same take) and `before-demo-thumbs.mp3` (unrelated). Automatic
pairing didn't fire — three videos with sound, not one — so all four were
transcribed, which put part two into the script twice and added fourteen minutes
of unrelated audio.

`voices` is what keeps the shot list useful: words from the mic get re-tagged
with the camera clip, so a scene tells you to scrub the file that's actually on
your timeline rather than an mp3. `offsetSec` is the one thing nothing can
infer — you sync in your NLE, read the delta, and type it in.

#### Script order comes from the filename

Several recordings become one transcript, and nothing inside a file knows when
it was shot (container timestamps are the export, not the take). So order comes
from what you named things — `01 - `, `02 - ` — and two details make the
convention hold, both of which the obvious implementation gets wrong:

- **Numeric collation**, so `9` sorts before `10`. Plain string comparison puts
  `10 - ` first, which is the classic way a numbered sequence silently reorders
  itself on its tenth entry.
- **Filename before folder**, so `screen/03 - demo` slots between
  `raw/02 - problem` and `raw/09 - nine`. Comparing whole paths lets the
  directory outrank the number that was actually typed.

### Step 2 — `extract-audio`: the big files never move

`ffmpeg -vn -ac 1 -ar 16000`, to mono 16 kHz mp3, into `os.tmpdir()`. Only that
goes to the transcription service.

Measured on an 11 GB camera file: **3.8 MB out**, identical duration, about
three minutes at 1% CPU. The cost is _reading_ the source, not transcoding it —
`-vn` drops the video stream, so ffmpeg is only demuxing.

Because that read is the expensive part, extraction is cached and skipped when
the existing mp3 is newer than its source. Re-running the pipeline is the normal
way to iterate on prompts, and without the check a 40 GB shoot would pay ten
minutes of disk on every single run. A zero-byte output counts as a cache miss —
that's a previous run that died mid-extract, and reusing it would send silence
to the transcriber.

Frames and audio go to `os.tmpdir()` and never into the project folder, or the
dev server's file watcher tries to follow thousands of PNGs and falls over.

### Step 3 — `transcribe`: words with times

AssemblyAI (`universal-3-5-pro`, falling back to `universal-2`), called directly
from a plain step rather than through the framework's voice API — that API
returns a plain string, and the entire architecture below this line depends on
word timing.

Two provider details shape everything:

- **`disfluencies: true` is mandatory.** AssemblyAI strips "um", "uh" and "hmm"
  by default, and cutting exactly those is half of what the next step exists to
  do. Without the flag the filler category is silently empty and the cleanup
  agent looks broken.
- **Timings come back in milliseconds** and everything downstream is in seconds.
  That conversion happens once, in one file, and nowhere else.

#### Telling the transcriber what it's listening to

Every asset this pipeline produces is a rewrite of the transcript, so a
transcription error doesn't stay one — a library name heard wrong comes back as
a confident misspelling in the b-roll briefs, the YouTube description, _and_ the
Twitter thread. Two hints fix it at the source:

- **What this is about** — a sentence or two of context. It describes the
  recording, not how to transcribe it; the model stays grounded in the audio, so
  context can't invent words.
- **Names and terms** — exact spellings to prefer, up to ~1000 words, 6 per
  phrase. The app refuses a longer list rather than letting terms past the limit
  silently stop working.

### Step 4 — `cleanup`: propose cuts, then stop ⏸

The agent sees numbered segments and returns cuts by index, categorised as
`filler`, `redundant`, `bad_take`, `tangent`, or `false_start`.

Long transcripts are windowed — 1200 segments per window with 20 segments of
overlap — so an hour of speech doesn't have to fit in one call.

Most of the agent's instructions are about **what not to cut**, because that's
the failure that matters. A pass that misses some filler is a mild annoyance;
one that sands off deliberate repetition, a callback, or a pause the speaker
meant to leave in has quietly rewritten the talk. That's precisely why the diff
exists and why nothing downstream runs before you've seen it.

**This is gate one.** The UI shows the diff — kept text normal, cut text
struck through and dimmed, grouped by category with counts (`filler: 82`,
`redundant: 6`, `bad_take: 3`) — and you toggle individual cuts back on
before approving. Approving is a plain write to `project.json`, not a resume:
nothing downstream runs until you do, because the scenario agent reads the
_approved_ script, not the raw transcript.

### Step 5 — `scenarios`: where b-roll actually helps

Reads the approved script and returns scene metadata only — no HTML. For each
scene: the segment range it covers, the script line verbatim, a one-line intent,
and a type (`diagram`, `code`, `data`, `process`, `concept`).

Splitting "where and why" from "what it looks like" is what makes the whole
thing affordable to iterate on. Placements are cheap to produce and cheap to
throw away; reviewing them before spending a model call per scene is the
difference between a wasted minute and a wasted twenty.

The window — how long the scene is allowed to animate for — comes from the gap
in the script, not from the model's opinion.

### Step 6 — `generate`: twelve scenes, three at a time

Batched `SCENE_CONCURRENCY` (3) at a time by `app/api/pipeline/route.ts`.
Modest on purpose: three concurrent agents stays inside rate limits, and
three Chromium instances validating at once is already as much as a laptop
wants to do while you're editing in the next window.

Each scene runs **generate → validate → repair**, up to three attempts. See
[section 5](#5-scene-generation-in-detail) — it's the hardest part of the system
and gets its own section.

Two rules make the batch survivable:

- **Nothing in a scene's generation is allowed to throw past its own job.**
  One bad scene must not cost the batch the eleven good ones — failures come
  back as `status: "failed"` with the reason attached to that scene's card,
  never a rejected promise that takes the others down with it.
- **Scene updates arrive out of order** and each is keyed by scene id, so the
  client reconciles them in place instead of appending.

While a scene is being written, the model's output is streamed to the browser at
about ten updates a second and dropped straight into an iframe — so you watch
the scene draw itself as it's typed, rather than staring at a spinner for the
better part of a minute.

### Step 7 — `review`: approve, reject, regenerate ⏸

**Gate two.** Per scene: approve, reject, or regenerate with a note.

Regeneration reruns the same generate → validate → repair path for whichever
scenes asked for it, as its own direct call — not a loop inside a suspended
run. A scene can go through that as many times as you have patience for; each
time is a fresh "Regenerate" click, and the gate is just the review screen
staying open until you're satisfied.

A regenerate can also **name a different model** — see
[section 7](#7-changing-the-model-for-one-scene).

### Step 8 — `export`: ProRes 4444 with alpha

Approved scenes only, **serialized, one at a time**. Chromium frame-stepping
plus an ffmpeg encode saturates a laptop on its own; four at once makes the
machine unusable. See [section 6](#6-export-in-detail).

### Step 9 — `copy`: YouTube and Twitter

Five title options, a description, chapters, tags; a hook tweet, a thread, and a
standalone insight tweet.

Written from the **approved** script — built by filtering the transcript through
the approved spans — so anything you cut is already gone. The distinction isn't
academic: copy that describes a point you cut, or a chapter for a tangent that
isn't in the edit, is wrong about the video it's describing.

### Step 10 — `shotlist`: the file on the second monitor

```
04:12  7.0s  scene_03.mov  "the agent picks up the job from the queue"
05:48  5.5s  scene_04.mov  "three passes run in parallel"
```

Plain text, not JSON, because a person reads it while editing. In daily use it's
the last thing the pipeline produces and the thing that gets looked at most.

---

## 5. Scene generation, in detail

A scene is **one self-contained HTML file**. All CSS in a `<style>` tag, no
external requests, no web fonts, no images that aren't inlined as data URIs.
Designed for a 1920×1080 frame. **No background on `html` or `body`** — scenes
are transparent overlays that sit on top of your footage.

### The constraints are technical, not stylistic

The exporter renders a scene by pausing every animation and setting
`currentTime` frame by frame. Everything below follows from that one mechanism:

- **All motion must be CSS animations or the Web Animations API.**
- **No `setTimeout`, `setInterval`, `requestAnimationFrame` timing, `Date.now()`
  or `performance.now()`.** Anything driven by wall-clock time renders
  **completely frozen** in the export while looking perfect in a live preview.
- **No `<canvas>`, no Lottie, no `<video>`, no GIFs.** Not reachable through
  `document.getAnimations()`.
- **Every animation must be finite.** An infinite animation has no end time and
  can never be frame-stepped to completion.
- **`animation-fill-mode: both`**, so the first and last frames hold. Without
  it, seeking to frame 0 shows the element unstyled.

The frozen-export failure is the nasty one: it's invisible until the `.mov` is
in your timeline, and fixing it retroactively means regenerating every scene
ever made.

### Validation: two layers, cheap first

[`validate-scene.ts`](src/mastra/lib/validate-scene.ts) runs a regex pass over
the source — catching a `setTimeout`, a CDN link, an `@import`, an opaque
background — before Chromium is ever launched. Then it loads the scene in a real
browser and measures it, because the constraint that matters most can't be read
off the source at all.

What the browser pass measures:

| Measured                       | Rejected when             | Because                                                 |
| ------------------------------ | ------------------------- | ------------------------------------------------------- |
| longest animation end time     | it exceeds the script gap | the scene is still animating when the next point starts |
| animation count                | zero                      | the export would be N identical frames                  |
| console errors                 | any                       | usually a syntax error in the generated CSS             |
| words of visible text          | more than 20              | see below                                               |
| how deep painted surfaces nest | more than 2               | see below                                               |

A scene that fails comes back with the specific complaints attached, plus its
previous attempt, and gets another go — up to three. Sending the old HTML back
rather than starting fresh matters: attempt one is usually right about the
composition and wrong about one constraint, and regenerating from scratch throws
away the part that worked.

### The taste rules, and why two of them are machine-checked

The scenes generated fine and still looked wrong. Measured across a real batch:

|        | words on screen | painted boxes | nesting |
| ------ | --------------- | ------------- | ------- |
| median | **49**          | 9             | 2       |
| worst  | **80**          | 19            | **5**   |

Those scenes run three to eleven seconds. 49 words takes about fifteen seconds
to read comfortably, so the text was never readable _even in principle_ — let
alone while listening to someone talk.

All of it traces to one forgotten premise: **these are shots, not slides.** They
play under a voice. So:

- **Twelve words is the target, twenty is the enforced ceiling.** The voice is
  the narration; text on screen competes with it and loses. Code is exempt — a
  stylized snippet is read as an image, and a prose budget would ban the `code`
  scene type outright.
- **No title, no eyebrow, no caption.** The lockup of a small uppercase pill
  above a big headline above a grey subtitle is the single strongest tell of a
  generated scene, and the speaker already said the title out loud.
- **One surface at most, ideally none.** Two things are compared by placing them
  apart and aligning them, not by drawing a box around each. Cards nested three
  deep are rejected.
- **No interface furniture** — status pills, `01`/`02` row indices, progress
  bars with numbers beside them, legends, tabs, window chrome. All of it says
  "screenshot of an app" rather than "shot in a film".

The first and third are measurable, so they're enforced by the validator. The
other two are prompt-only, because there's no reliable way to detect them.

Running the new checks against the eleven original scenes rejects **all eleven** —
which is the right answer, since a human had already rejected all eleven.

### The style guide, and one thing that was built then removed

Parallel agents given the same brief and no shared palette produce twelve
individually-reasonable scenes that look like they came from twelve different
videos. So one style guide object — palette, font stack, motion character,
notes — goes to every scene agent.

It briefly had **its own agent and its own pipeline step**, deriving a look per
project from a sample of the transcript. Both are gone, for two reasons:

1. A transcript says what a video is _about_, not what it should look like.
2. A look invented per project means video three doesn't match video one — and
   consistency across a channel is the entire reason to have a guide.

It's now a house default written down in [design.md](design.md), overridable per
project in the UI, and everything about the look that never varies moved into
the scene agent's prompt. Removing it also removed a blocking model call from
before scene generation.

Palette order is meaningful and the agent is told to read it that way: first
colour is the dominant surface, second is primary text, the rest are accents —
and at most one accent belongs in any single scene.

---

## 6. Export, in detail

```js
// pause everything, then step it
await page.evaluate(() => document.fonts.ready)
await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()))

for (let frame = 0; frame < totalFrames; frame++) {
  const ms = (frame / fps) * 1000
  await page.evaluate(
    (t) =>
      document.getAnimations().forEach((a) => {
        a.currentTime = t
      }),
    ms
  )
  await page.screenshot({
    path: `${dir}/${pad(frame)}.png`,
    omitBackground: true,
  })
}
```

Then ffmpeg encodes the PNG sequence:

```
ffmpeg -framerate 30 -i frames/%05d.png \
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le exports/scene_03.mov
```

The details that are not negotiable:

- **`await document.fonts.ready` before the first frame**, or the opening frames
  render in a fallback font — subtle enough to survive review and obvious once
  it's in the edit.
- **`omitBackground: true`** → PNGs with alpha → ProRes 4444 → the scene
  overlays your footage instead of cutting away from it. This only works because
  scenes set no background of their own.
- **fps is a project setting** and must match your timeline, or the result
  judders.
- **Frames go to `os.tmpdir()`**, in a directory unique per call. Two exports of
  the same scene running at once used to share one path, and each one's cleanup
  deleted the other's frames mid-render — which surfaced as an `ENOENT` five
  hundred frames in, on scenes that were perfectly fine.

### The 4K fix

Exports looked soft. The first suspicion — that they were being encoded at low
quality — was wrong: `ffprobe` on all eleven files showed 1920×1080 ProRes 4444
`yuva444p12le` at 63–147 Mbps. Correct codec, correct alpha, no
over-quantization.

The actual cause was that a true 1080p file dropped on a 4K timeline gets
upscaled by the NLE. Vector-crisp type enlarged by 200% is exactly the kind of
soft that's hard to name.

The fix is one number, and it works because **`deviceScaleFactor` is
rasterization density, which is a separate question from layout.**
`window.innerWidth` stays 1920 either way; the scale factor decides how many
device pixels each CSS pixel is drawn with. At 2, the same 1920-wide layout
rasterizes into a 3840×2160 frame — the glyphs are _drawn_ at 4K rather than
enlarged to it.

Measured on the same clip: **1080p 7.39 MB in 2.9s vs 4K 20.98 MB in 11.0s.**
Only the export pays that; measuring and thumbnails stay at 1×.

This is also a place where the original spec was wrong. It called for a 960×540
viewport at scale 2, reasoning that a 1920-wide viewport at scale 1 gives
"correct dimensions but half the effective text density". That's true when
scenes are authored at 960 — but the same spec tells the scene agent to design
for 1920×1080, and both can't hold. In a 960 CSS viewport a scene laid out at
1920 renders only its top-left quarter and `100vw` covers half the frame.
Authoring space wins.

---

## 7. Changing the model for one scene

Scene generation is the one place in the pipeline where the model is worth
choosing per call. It's the only output judged by eye and thrown back, and a
scene that has come back wrong twice is exactly when it's worth paying for a
slower model — while moving the other eleven onto it would be waste. The other
agents produce text nobody re-rolls a model over.

There's still only one scene agent. Mastra resolves an agent's `model` per
request, so the agent reads the id off the request context and the prompt, the
style guide and the constraint list all stay identical:

```ts
model: ({ requestContext }) =>
  requestContext.get(SCENE_MODEL_KEY) ?? SCENE_MODEL
```

The choice rides on the review decision and is stored on the scene, so
`project.json` records what actually wrote each version — **including on a
failure**, where knowing which model couldn't do it is most of the diagnosis.

---

## 8. The app around it

### Three screens, and no fourth

Projects list → project view → that's it. The project view is five **stages**,
each owning a contiguous run of pipeline steps _and_ the UI for what those steps
produce:

`Footage & transcript` · `Transcript cleanup` · `Style guide` · `Scenes` ·
`Copy & shot list`

The join is the point. Progress used to live in one panel and the work in a
separate row of tabs under different names, so watching a step finish told you
nothing about where to go to act on it — and the two moments that genuinely
need a human were the hardest things on the page to find. Now "Cleanup is
waiting for you" and the diff you approve are the same object on screen.

### Scene previews are sandboxed, and the sandbox has a consequence

Scene HTML is never served as a file. It's read server-side, passed as a string,
and dropped into an iframe:

```jsx
<iframe sandbox="allow-scripts" srcDoc={html} />
```

`allow-scripts` **without** `allow-same-origin` — generated code must not be
able to reach the app. That also means the page can't touch the iframe's
document, so the scrubber is a small controller injected alongside the scene
that drives `document.getAnimations()` over `postMessage` — the same mechanism
the exporter uses when it frame-steps.

Which gives a useful property: **a scene that scrubs correctly in the preview is
a scene that exports correctly.** One that uses `setTimeout` for timing looks
right on play and freezes under the scrubber, so the bug surfaces at review
instead of in your timeline.

Previews mount only while on screen. A scene preview is a live 1920×1080
document, and a dozen at once will stall the compositor.

### Streaming, typed end to end

[`stream/contract.ts`](src/mastra/stream/contract.ts) declares every event once.
The same object feeds the client's typed message stream and the server's
emitter, so a step emitting `data-scene` and a component reading `part.data` are
checked against one definition.

The client uses the AI SDK's `useChat` for something that is not a chat, on
purpose: what it provides — an append-and-reconcile message stream, typed data
parts, and a transport that survives a response lasting minutes — is exactly
what a pipeline with fourteen kinds of progress event needs.

And the stream is _only_ a liveness channel. Everything it carries has already
been written to `project.json` by the step that emitted it.

---

## 9. What was learned the hard way

A short list of things that only showed up on real footage:

- **Transcribing everything with sound is wrong**, and wrong quietly. It took a
  real four-file folder to notice the script contained part two twice.
- **The scenes were unreadable**, and the way to prove it was to count: median
  49 words on a 3–11 second shot. Taste arguments end when a number shows up.
- **"Low quality export" wasn't low quality.** It was a correct 1080p file being
  upscaled by the editor. Measuring first stopped a pointless bitrate hunt.
- **A style guide per project defeats the purpose of a style guide.** Built,
  shipped, removed.
- **A stepless stage claimed success** because `[].every()` is `true`. The empty
  case needs its own answer.

---

## 10. Deliberately not built

All reasonable, none needed to find out whether the idea works:

Dropping **scenes** onto a timeline automatically — the cut timeline itself now
exports as FCPXML (step `fcpxml`, `docs/adr/0001-…`), but scenes as connected
clips on `lane="1"` are a later iteration · cut
suggestions as a user-facing feature · multi-take clustering · coverage-gap
detection ("as you can see here", with no matching footage) · short-form clip
extraction · captions · terminology consistency checking · hook analysis of the
first 30 seconds · a native app wrapper.

---

## 11. The numbers

|                              |                                     |
| ---------------------------- | ----------------------------------- |
| Pipeline                     | 11 steps, 2 human gates, 0 workflow engine |
| Scene concurrency            | 3                                   |
| Export concurrency           | 1                                   |
| Attempts per scene           | 3 (generate + 2 repairs)            |
| Word budget per scene        | 12 target, 20 enforced              |
| Surface nesting limit        | 2                                   |
| Audio out of an 11 GB source | 3.8 MB                              |
| Export, 1080p → 4K           | 7.39 MB / 2.9s → 20.98 MB / 11.0s   |
| Segment split                | 0.6s pause, 12s cap                 |
| Cleanup window               | 1200 segments, 20 overlap           |
| Tests                        | 159                                 |

---

## Where to look in the code

| Question                                | File                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| What is the pipeline?                   | [`app/api/pipeline/route.ts`](app/api/pipeline/route.ts) and [`steps/`](src/mastra/steps)                                   |
| What does `project.json` look like?     | [`schemas.ts`](src/mastra/schemas.ts)                                                                                       |
| How do words become segments and spans? | [`lib/segments.ts`](src/mastra/lib/segments.ts)                                                                             |
| Which files get transcribed?            | [`lib/media.ts`](src/mastra/lib/media.ts)                                                                                   |
| What must a scene obey?                 | [`agents/scene-agent.ts`](src/mastra/agents/scene-agent.ts) and [`lib/validate-scene.ts`](src/mastra/lib/validate-scene.ts) |
| How is a scene exported?                | [`lib/render.ts`](src/mastra/lib/render.ts)                                                                                 |
| What does the app look like?            | [`lib/stages.ts`](lib/stages.ts) and [`components/project/`](components/project)                                            |
| What should a scene look like?          | [design.md](design.md)                                                                                                      |
