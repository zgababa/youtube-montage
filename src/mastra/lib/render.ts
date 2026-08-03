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
 * iframe both assume. At 1920×1080 CSS with scale 1 there is no scaling
 * anywhere: a 96px heading is 96 pixels in the export, and viewport units mean
 * what they say. The density concern doesn't apply — it was about upscaling a
 * 960-wide design, which is no longer what happens.
 */
const VIEWPORT = { width: 1920, height: 1080 }
const DEVICE_SCALE_FACTOR = 1

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
  body: (page: Page) => Promise<T>
): Promise<T> {
  const context = await (
    await getBrowser()
  ).newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
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

    const { durationSec, animationCount } = await page.evaluate(() => {
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
      return { durationSec: end / 1000, animationCount: animations.length }
    })

    return { durationSec, animationCount, consoleErrors }
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
 * at 30fps is 210 PNGs at 1920×1080; written inside the project folder, the
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

    await withScene(html, async (page) => {
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
    })

    await encodeProRes(framesDir, fps, outputPath)
  } finally {
    await fs.rm(framesDir, { recursive: true, force: true })
  }
}
