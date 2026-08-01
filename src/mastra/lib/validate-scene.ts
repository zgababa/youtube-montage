/**
 * Does this generated scene actually export?
 *
 * Two layers, cheap first. A regex pass catches the constraints that are
 * visible in the source — a `setTimeout`, a CDN link — before Chromium is
 * launched. Then the scene is measured the same way the exporter will step it,
 * because the constraint that matters most (the animation fits its window)
 * can't be read off the source at all.
 *
 * Everything here maps to a specific failure in the edit:
 *
 *   - JS timing → the export renders frozen while the preview looks perfect
 *   - external requests → the scene renders unstyled on a machine that's offline
 *   - a background → the overlay becomes a full-frame cutaway
 *   - zero animations → an export of N identical frames
 *   - overrunning the window → the scene is still animating when the gap ends
 */

import { measureScene } from "./render"

export interface ValidationResult {
  ok: boolean
  /** Measured longest animation end time. Zero when nothing animates. */
  durationSec: number
  /** Written for the repair prompt, so phrase them as instructions. */
  problems: string[]
}

interface Ban {
  pattern: RegExp
  problem: string
}

const BANS: Ban[] = [
  {
    pattern: /\bsetTimeout\s*\(/,
    problem:
      "Uses setTimeout. All motion must be CSS animations or the Web Animations API — the exporter steps currentTime frame by frame, so anything on a JS timer renders frozen.",
  },
  {
    pattern: /\bsetInterval\s*\(/,
    problem:
      "Uses setInterval. All motion must be CSS animations or the Web Animations API.",
  },
  {
    pattern: /\brequestAnimationFrame\s*\(/,
    problem:
      "Uses requestAnimationFrame. All motion must be CSS animations or the Web Animations API.",
  },
  {
    pattern: /\bDate\.now\s*\(|\bperformance\.now\s*\(|new\s+Date\s*\(/,
    problem:
      "Reads wall-clock time. The exporter controls time itself; wall-clock reads produce a frozen export.",
  },
  {
    pattern: /<canvas\b/i,
    problem:
      "Uses <canvas>. Canvas content is not reachable via document.getAnimations() and cannot be frame-stepped.",
  },
  {
    pattern: /<video\b|<audio\b/i,
    problem: "Uses <video> or <audio>. Scenes are silent CSS animations only.",
  },
  {
    pattern: /animation-iteration-count\s*:\s*infinite|\binfinite\b(?=[^;]*;)/,
    problem:
      "Has an infinite animation. Every animation must be finite, or it has no end time and can never be frame-stepped to completion.",
  },
  {
    pattern: /@import\b/,
    problem: "Uses @import. The scene must be fully self-contained.",
  },
  {
    pattern: /(?:src|href)\s*=\s*["']https?:\/\//i,
    problem:
      "Loads an external resource. No CDN links, no remote images, no web fonts — the scene must render with no network.",
  },
  {
    pattern: /url\(\s*["']?https?:\/\//i,
    problem:
      "References a remote URL in CSS. Inline any asset as a data URI instead.",
  },
]

/**
 * An `html`/`body` rule that paints a background.
 *
 * The lookbehind keeps `.body` and `#body` out of it, and `transparent` and
 * friends are explicitly allowed — the ban is on painting a canvas, not on
 * mentioning the property.
 */
const OPAQUE_BACKGROUND =
  /(?<![\w.#-])(?:html|body)\b[^{}]*\{[^}]*background(?:-color)?\s*:\s*(?!\s*(?:none|transparent|inherit|initial|unset)\b)[^;}]+/i

/**
 * Only the CSS, not the whole document.
 *
 * Running the background check over raw HTML matches `<body class="...">`
 * followed by any stray brace in the markup, and misses `<style>body{…}`
 * because the `>` isn't a selector boundary.
 */
function styleBlocks(html: string): string {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n")
}

export function staticProblems(html: string): string[] {
  const problems: string[] = []

  for (const ban of BANS) {
    if (ban.pattern.test(html)) problems.push(ban.problem)
  }

  if (OPAQUE_BACKGROUND.test(styleBlocks(html))) {
    problems.push(
      "Sets a background on html or body. Scenes are transparent overlays composited over camera footage — remove the background entirely."
    )
  }

  return problems
}

/**
 * Full validation. Skips the browser when the source is already disqualified,
 * since a scene that reads the clock will be regenerated regardless of how
 * long it animates for.
 */
export async function validateScene(
  html: string,
  windowSec: number
): Promise<ValidationResult> {
  const problems = staticProblems(html)
  if (problems.length > 0) return { ok: false, durationSec: 0, problems }

  const measurement = await measureScene(html)

  if (measurement.consoleErrors.length > 0) {
    problems.push(
      `The page raised errors while loading: ${measurement.consoleErrors.slice(0, 3).join("; ")}`
    )
  }

  if (measurement.animationCount === 0) {
    problems.push(
      "No animations were found via document.getAnimations(). The scene renders as a still image."
    )
  } else if (measurement.durationSec <= 0) {
    problems.push(
      "Animations exist but the longest one has no finite end time. Give every animation an explicit duration and a finite iteration count."
    )
  } else if (measurement.durationSec > windowSec) {
    problems.push(
      `The animation runs ${measurement.durationSec.toFixed(1)}s but the available window is ${windowSec.toFixed(1)}s. Shorten it to comfortably under the window — reduce delays and durations rather than cutting elements.`
    )
  }

  return {
    ok: problems.length === 0,
    durationSec: measurement.durationSec,
    problems,
  }
}
