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

import type { ChannelStyle } from "../schemas"

/**
 * The house look — same palette/typography/motion as the old
 * `DEFAULT_STYLE_GUIDE` in `lib/project.ts`, now carrying a card deck.
 */
const DEFAULT_STYLE: ChannelStyle = {
  id: "default",
  palette: ["#F5F5F7", "#0B0B0F", "#FF6B5A"],
  fontStack: 'ui-sans-serif, -apple-system, system-ui, "Segoe UI", sans-serif',
  motion:
    "Choreographed, not simultaneous: entrances stagger 40–80ms apart on a long ease-out, 400–900ms for a major move, opacity and scale and blur only, holds between beats.",
  notes:
    "Light and airy, Apple keynote restraint. Near-white surfaces carrying near-black type, warm coral as the only accent. One idea per scene, almost no words — the voiceover is doing the explaining.",
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
