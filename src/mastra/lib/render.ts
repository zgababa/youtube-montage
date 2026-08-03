/**
 * Chromium: measuring scenes, thumbnailing them, and frame-stepping the export.
 *
 * All three do the same thing — pause `document.getAnimations()` and set
 * `currentTime` — which is why idea.md §5 bans `setTimeout`, `rAF`, and
 * `Date.now()` from generated scenes. Anything driven by wall-clock time looks
 * perfect in a live preview and renders frozen here.
 */

import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { Browser, Page } from "playwright"

import { encodeProRes } from "./ffmpeg"
import { tmpDir } from "./paths"

/**
 * The frame, in the same coordinates scenes are written in.
 *
 * idea.md §6 specifies a 960×540 viewport at `deviceScaleFactor: 2`, reasoning
 * that screenshotting a 1920-wide viewport at scale 1 gives "correct dimensions
 * but half the effective text density". That holds when scenes are authored at
 * 960 — but §5 tells the scene agent to design for 1920×1080, and the two can't
 * both be true. With a 960 CSS viewport a scene laid out at 1920 renders only
 * its top-left quarter, and `100vw` covers half the frame.
 *
 * Authoring space wins, since it's what the agent's prompt and the preview
 * iframe both assume. The viewport stays 1920×1080 CSS: a 96px heading is 96
 * CSS pixels and viewport units mean what they say.
 */
const VIEWPORT = { width: 1920, height: 1080 }

/**
 * Rasterization density, which is a separate question from layout.
 *
 * `deviceScaleFactor` doesn't move anything — `window.innerWidth` is 1920
 * either way — it decides how many device pixels each CSS pixel is drawn with.
 * At 1 the export was a true 1080p file, and a true 1080p file dropped on a 4K
 * timeline is scaled up by the NLE, which is what made crisp vector type look
 * soft. At 2 the same layout rasterizes to 3840×2160: the glyphs are *drawn* at
 * 4K rather than enlarged to it.
 *
 * Four times the pixels, so roughly four times the frame size and the encode
 * time. Only the export pays it — measuring reads animation timings and doesn't
 * care, and a list thumbnail at 4K would be absurd.
 */
const EXPORT_SCALE = 2
const PREVIEW_SCALE = 1

let browser: Browser | undefined

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    const { chromium } = await import("playwright")
    browser = await chromium.launch()
  }
  return browser
}

/** Called when the process is shutting down; safe to skip. */
export async function closeBrowser() {
  await browser?.close()
  browser = undefined
}

/**
 * Opens a page with the scene loaded and every animation paused at frame zero.
 *
 * `document.fonts.ready` is awaited before anything is measured or captured —
 * without it the opening frames render in a fallback font, which is subtle
 * enough to survive review and obvious once it's in the edit.
 */
async function withScene<T>(
  html: string,
  body: (page: Page) => Promise<T>,
  deviceScaleFactor = PREVIEW_SCALE
): Promise<T> {
  const context = await (
    await getBrowser()
  ).newContext({
    viewport: VIEWPORT,
    deviceScaleFactor,
  })
  const page = await context.newPage()
  try {
    await page.setContent(html, { waitUntil: "load" })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() =>
      document.getAnimations().forEach((animation) => animation.pause())
    )
    return await body(page)
  } finally {
    await context.close()
  }
}

/* -------------------------------------------------------------------------- */
/* Measuring                                                                   */
/* -------------------------------------------------------------------------- */

export interface SceneMeasurement {
  /** Longest animation end time, in seconds. */
  durationSec: number
  /** How many animations the document exposes. Zero means nothing moves. */
  animationCount: number
  /** Console errors raised while loading — usually a syntax error in the scene. */
  consoleErrors: string[]
  /** Words of visible text, counted from what actually renders. */
  wordCount: number
  /**
   * How deeply painted surfaces nest — a chip inside a card inside a panel is
   * 3. One is a scene with a single surface; zero is a scene composed of things
   * rather than of boxes.
   */
  surfaceDepth: number
}

/**
 * Measures a generated scene the same way the exporter will.
 *
 * The duration this returns is authoritative: it's read from the animations
 * themselves rather than from whatever the agent claimed, which is how a scene
 * animating fifteen seconds into a seven-second gap gets caught at generation
 * time instead of in the edit.
 */
export async function measureScene(html: string): Promise<SceneMeasurement> {
  return withScene(html, async (page) => {
    const consoleErrors: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    page.on("pageerror", (error) => consoleErrors.push(error.message))

    const measured = await page.evaluate(() => {
      const animations = document.getAnimations()
      let end = 0
      for (const animation of animations) {
        const timing = animation.effect?.getComputedTiming()
        const endTime = timing?.endTime
        // Infinite iterations produce an infinite end time. §5 forbids them
        // precisely because they can never be frame-stepped to completion.
        if (typeof endTime === "number" && Number.isFinite(endTime)) {
          end = Math.max(end, endTime)
        }
      }

      const countWords = (text: string) =>
        text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length

      // `innerText` rather than `textContent`: it reflects what renders, so a
      // `display: none` variant doesn't count against the budget. Elements
      // still at `opacity: 0` do count — they animate in later, and the budget
      // is about what ends up on screen, not what's there at frame zero.
      //
      // Code doesn't count. A `code` scene is a stylized snippet revealed line
      // by line, and it's read as an image rather than as prose — holding it to
      // a prose budget would ban the scene type outright. Only the outermost
      // `pre`/`code` is subtracted, or a `pre > code` would be taken off twice.
      let codeWords = 0
      for (const block of document.querySelectorAll("pre, code")) {
        if (block.parentElement?.closest("pre, code")) continue
        codeWords += countWords((block as HTMLElement).innerText || "")
      }

      const words = Math.max(
        0,
        countWords(document.body.innerText || "") - codeWords
      )

      /**
       * A painted, rounded container — a card, a panel, a pill.
       *
       * Both conditions matter. Background alone catches a full-bleed wash or a
       * progress track; the corner radius is what makes it read as a *box* laid
       * on the frame, which is the thing being counted.
       */
      function isSurface(element: Element): boolean {
        const style = getComputedStyle(element)
        const parts = /rgba?\(([^)]+)\)/
          .exec(style.backgroundColor)?.[1]
          .split(",")
          .map((value) => parseFloat(value))
        if (!parts) return false
        const alpha = parts.length > 3 ? parts[3] : 1
        if (alpha < 0.03) return false
        return (parseFloat(style.borderTopLeftRadius) || 0) >= 8
      }

      let surfaceDepth = 0
      for (const element of document.querySelectorAll("*")) {
        if (!isSurface(element)) continue
        let depth = 1
        let parent = element.parentElement
        while (parent) {
          if (isSurface(parent)) depth++
          parent = parent.parentElement
        }
        surfaceDepth = Math.max(surfaceDepth, depth)
      }

      return {
        durationSec: end / 1000,
        animationCount: animations.length,
        wordCount: words,
        surfaceDepth,
      }
    })

    return { ...measured, consoleErrors }
  })
}

/* -------------------------------------------------------------------------- */
/* Thumbnails                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A single frame, for the projects list.
 *
 * Taken at the midpoint because scene openings are usually near-empty — most
 * scenes fade in — and a thumbnail of an empty frame is indistinguishable from
 * a scene that failed.
 */
export async function screenshotMidpoint(
  html: string,
  durationSec: number
): Promise<Buffer> {
  return withScene(html, async (page) => {
    const ms = (durationSec * 1000) / 2
    await page.evaluate((time) => {
      document.getAnimations().forEach((animation) => {
        animation.currentTime = time
      })
    }, ms)
    return page.screenshot({ omitBackground: true })
  })
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

export interface ExportOptions {
  fps: number
  durationSec: number
  outputPath: string
  onProgress?: (frame: number, totalFrames: number) => void | Promise<void>
}

/**
 * Frame-steps a scene to PNGs and encodes them to ProRes 4444 with alpha.
 *
 * `omitBackground: true` is what preserves that alpha, and it only works
 * because scenes set no background of their own (§5) — an overlay that cuts
 * away from the footage instead of sitting on top of it is the failure this
 * prevents.
 *
 * Frames land in `os.tmpdir()` and are deleted after encoding. A 7-second scene
 * at 30fps is 210 PNGs at 3840×2160; written inside the project folder, the
 * dev server's watcher would try to follow all of them.
 *
 * The directory is unique per call, not per scene. Two exports of the same
 * scene running at once — which a second `run.resume()` will happily start —
 * used to share one path, and each one's cleanup deleted the other's frames
 * mid-render. That surfaced as `ENOENT` on a frame five hundred into the
 * sequence, or as ffmpeg reporting an empty directory, on scenes that were
 * perfectly fine.
 */
export async function exportScene(
  html: string,
  options: ExportOptions
): Promise<void> {
  const { fps, durationSec, outputPath, onProgress } = options
  const framesDir = tmpDir(
    "frames",
    `${path.parse(outputPath).name}-${randomUUID()}`
  )

  await fs.mkdir(framesDir, { recursive: true })

  try {
    const totalFrames = Math.max(1, Math.ceil(durationSec * fps))

    await withScene(
      html,
      async (page) => {
        for (let frame = 0; frame < totalFrames; frame++) {
          const ms = (frame / fps) * 1000
          await page.evaluate((time) => {
            document.getAnimations().forEach((animation) => {
              animation.currentTime = time
            })
          }, ms)
          await page.screenshot({
            path: path.join(framesDir, `${String(frame).padStart(5, "0")}.png`),
            omitBackground: true,
          })
          // Throttled by the caller — reporting all 210 frames of a short scene
          // floods the stream with chunks nobody reads.
          await onProgress?.(frame + 1, totalFrames)
        }
      },
      EXPORT_SCALE
    )

    await encodeProRes(framesDir, fps, outputPath)
  } finally {
    await fs.rm(framesDir, { recursive: true, force: true })
  }
}
