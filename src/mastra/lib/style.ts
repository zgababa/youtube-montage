/**
 * Resolving a `styleRef` into the channel's `Style` (issue #24).
 *
 * Building the actual style library — palette, typography, motion, the real
 * card deck — is a design prerequisite of this spec, not a deliverable of it
 * (issue #22's Out of Scope). What *is* in scope is the resolution seam: a
 * `styleRef` names a `Style` once, and every scene on the channel reuses the
 * same resolved object rather than a guide reinvented per video.
 *
 * The single `"default"` style below is a stand-in with just enough cards to
 * exercise every `SceneType` purpose — the real deck is a later, non-engineering
 * chantier.
 */

import type { ChannelStyle, StyleGuide } from "../schemas"

/**
 * The house look, `design.md` compressed — palette, typography, motion, taste.
 *
 * The single source of truth for those four fields. `blankProject` derives the
 * legacy `project.styleGuide` from it (`lib/project.ts`) rather than keeping a
 * second copy: while both shapes exist, a channel that changes its palette here
 * must not find the old one still stamped onto new projects.
 *
 * Palette order is meaningful: dominant surface, primary text, then accents.
 */
export const HOUSE_LOOK: StyleGuide = {
  palette: ["#F5F5F7", "#0B0B0F", "#FF6B5A"],
  fontStack: 'ui-sans-serif, -apple-system, system-ui, "Segoe UI", sans-serif',
  motion:
    "Choreographed, not simultaneous: entrances stagger 40–80ms apart on a long ease-out, 400–900ms for a major move, opacity and scale and blur only, holds between beats.",
  notes:
    "Light and airy, Apple keynote restraint. Near-white surfaces carrying near-black type, warm coral as the only accent. One idea per scene, almost no words — the voiceover is doing the explaining. Generous negative space, large tight-tracked type, depth from blur and soft shadow rather than borders. No cards unless something genuinely needs its own plane.",
}

/** The house look carrying a card deck — the `Style` a `styleRef` resolves to. */
const DEFAULT_STYLE: ChannelStyle = {
  id: "default",
  ...HOUSE_LOOK,
  cards: [
    {
      id: "concept-headline",
      tier: "primary",
      purpose: "concept",
      slots: [{ id: "headline", type: "text", maxLength: 80 }],
    },
    {
      id: "diagram-label",
      tier: "primary",
      purpose: "diagram",
      slots: [{ id: "label", type: "text", maxLength: 60 }],
    },
    {
      id: "code-snippet",
      tier: "primary",
      purpose: "code",
      slots: [{ id: "snippet", type: "text", maxLength: 200 }],
    },
    {
      id: "data-stat",
      tier: "primary",
      purpose: "data",
      slots: [
        { id: "stat", type: "text", maxLength: 12 },
        { id: "label", type: "text", maxLength: 40 },
      ],
    },
    {
      id: "process-steps",
      tier: "primary",
      purpose: "process",
      slots: [
        { id: "step1", type: "text", maxLength: 40 },
        { id: "step2", type: "text", maxLength: 40 },
        { id: "step3", type: "text", maxLength: 40 },
      ],
    },
  ],
}

const STYLES: Record<string, ChannelStyle> = {
  default: DEFAULT_STYLE,
}

/**
 * Looks up a channel's `Style` by reference.
 *
 * Throws rather than falling back to a default — an unresolvable reference is
 * a configuration error the run should surface, not paper over (issue #22's
 * explicit-error stance carried into style resolution).
 */
export function resolveStyle(styleRef: string): ChannelStyle {
  const style = STYLES[styleRef]
  if (!style) {
    throw new Error(
      `Unknown style reference "${styleRef}" — no channel style registered under this id.`
    )
  }
  return style
}

/**
 * Test-only seam: registers a `ChannelStyle` under `styleRef` so tests can
 * exercise `resolveStyle`-dependent code (e.g. `generateAndPersistScene`)
 * against a deck that's missing a purpose, without reaching into `STYLES`
 * directly or forcing every `SceneType` to lack a card in the real default
 * deck (issue #25 — every `SceneType` currently has one). Not called by
 * production code.
 *
 * Returns the undo. `STYLES` is module-level and every test file in a Bun run
 * shares it, so a registration that outlives its test would leave a `styleRef`
 * resolvable for the rest of the process — the caller must restore in a
 * teardown rather than leak a style the channel never declared.
 */
export function registerStyleForTest(
  styleRef: string,
  style: ChannelStyle
): () => void {
  const previous = STYLES[styleRef]
  STYLES[styleRef] = style
  return () => {
    if (previous) STYLES[styleRef] = previous
    else delete STYLES[styleRef]
  }
}
