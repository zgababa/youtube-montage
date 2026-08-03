# Design language — what the scenes should look like

The house style for generated b-roll. `idea.md` §5 says what a scene must
technically be; this says what it should look like. Everything here that a model
needs to obey is already in `sceneAgent`'s system prompt — this document is the
reasoning behind those lines, and the place to change them from.

Adapted from the B-Roll Studio doc, which described a hand-built Vite + React +
Motion project. The taste carries over unchanged. The format does not, and the
differences are load-bearing — see [What doesn't carry over](#what-doesnt-carry-over).

## Design language

**Clean, minimal, confident.** Every scene should look like it belongs in an
Apple product film.

- **Space is the layout.** Generous negative space, one focal idea per scene.
  Never crowd the frame.
- **Typography carries the message.** Large, tight-tracked headlines, restrained
  weights. Text appears sparingly and deliberately.
- **Light, not dark.** Near-white surfaces carrying near-black type. Both work
  over footage, but a light surface reads as something deliberately placed on
  top of the shot, where a near-black one tends to read as the footage dipping.
- **Restrained palette.** Monochrome, with at most one accent colour per scene.
  Soft gradients and elevation over hard borders.
- **Depth through light, not lines.** Blur, glow, translucency, soft shadow —
  instead of visible strokes and boxes.
- **No clutter.** No watermarks, no fake browser chrome, no cursors, no debug UI.

## Animation principles

Motion is the product. These apply to every scene:

- **Choreographed, not simultaneous.** Elements enter in a deliberate sequence
  with small staggers (40–80ms), guiding the eye through the story.
- **Ease-out for entrances** — fast start, gentle landing. Never `ease-in` on
  something appearing, never `linear` on anything.
- **Physical and continuous.** Things scale from where they originate (correct
  `transform-origin`), fade and translate together, and never teleport.
  Crossfade rather than cut; blur can mask a transition.
- **Calm tempo.** B-roll is watched, not clicked. 400–900ms for major moves,
  with holds between beats so the edit has room.
- **Scale subtly.** Prefer `scale(0.95 → 1)` and small translations over
  dramatic flying. Big motion is reserved for the one hero moment of a scene.
- **60fps or nothing.** Animate only `transform`, `opacity` and `filter`.
  Frame-stepping means the export itself can't drop a frame, but animating
  layout properties stutters in the live preview and scrubber, and makes every
  exported frame slower to render.

## Content

- Visualize **concepts, not screenshots**: abstract diagrams, flowing messages,
  connecting nodes, elegant text reveals — stylized representations of what the
  script describes.
- When code or terminal output appears it is **stylized** — beautiful monospace,
  syntax-highlight accents, line-by-line reveals — not a raw editor capture.
- Every scene answers one question: _what single idea from this script part
  should the viewer feel?_

## The style guide object

`project.styleGuide` is the per-project part of the above: `palette`,
`fontStack`, `motion`, `notes`. It exists because scenes generate in parallel —
twelve agents given the same brief and no shared palette produce twelve
individually-reasonable scenes that look like they came from twelve different
videos.

Its default is this document, compressed (`DEFAULT_STYLE_GUIDE` in
`src/mastra/lib/project.ts`). It is a **house style with a per-project override**,
not something derived per project: a channel wants consistency across videos,
and a transcript says what a video is about, not what it should look like.

Palette order is meaningful and the scene agent reads it that way: first colour
is the dominant surface, second is primary text, the rest are accents.

## What doesn't carry over

The source doc assumed a Vite + React + Motion project whose scenes are screen
recorded from a browser. These scenes are single HTML files, rendered headless
by Playwright and frame-stepped to ProRes. Four rules invert:

| B-Roll Studio                        | Here                                         | Why                                                                                                                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite + React + Motion                | One self-contained HTML file, CSS/WAAPI only | Motion's springs run on `requestAnimationFrame`, which is invisible to `document.getAnimations()`. The exporter pauses animations and sets `currentTime`, so a spring renders **frozen** — and the validator rejects the scene outright as having no animations. |
| Near-black or near-white backgrounds | **No background at all**                     | Scenes are transparent overlays composited over the camera footage. A background turns the scene into a full-frame cutaway. The light register lives on the scene's own surfaces — panels, cards, type — not on the frame.                                        |
| Settles into a gentle idle loop      | Settles into a **held** end state            | An infinite animation has no end time, so it can't be frame-stepped. `animation-fill-mode: both` holds the last frame instead.                                                                                                                                   |
| 5–15 seconds, one route per scene    | The window comes from the gap in the script  | Placement is decided by the scenario agent against the approved transcript. Windows vary widely, and a scene that overruns its gap is thrown away.                                                                                                               |

One more that isn't a conflict but changes what the design has to survive:
exported frames are instantaneous samples with **no motion blur**, so fast
movement strobes against real footage. This is the reason for the calm tempo
above, not merely a preference.
