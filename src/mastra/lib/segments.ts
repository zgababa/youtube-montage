/**
 * Between the word list and the cleanup agent.
 *
 * idea.md §3 is emphatic that the AI emits *decisions on spans*, never prose.
 * The naive way to honour that is to hand the model the word array and ask for
 * `{start, end}` floats back. It fails on two counts: an hour of speech is
 * ~9,000 words, and word-level JSON costs roughly ten times the tokens of the
 * same text; and a model asked to echo thousands of precise timestamps will
 * eventually invent one, which is exactly the failure §3 exists to prevent.
 *
 * So the model never sees raw timings. Words are grouped into numbered
 * segments, the model refers to segments by index, and the arithmetic that
 * turns indices back into seconds happens here, deterministically.
 *
 * The second rule is subtler: **the model is only ever asked what to cut.**
 * Keeps are derived by filling the gaps. Asking for both invites a model to
 * drop a stretch of transcript it simply forgot to mention, and the "clean
 * script" — which is nothing but the kept spans concatenated — would silently
 * lose a paragraph.
 */

import type { Span, SpanCategory, Word } from "../schemas"

export interface Segment {
  index: number
  start: number
  end: number
  text: string
  file: string
}

/** A gap this long reads as the end of a thought. */
const PAUSE_SEC = 0.6

/** Ceiling on segment length, so an unbroken monologue still gets cut points. */
const MAX_SEGMENT_SEC = 12

/**
 * Groups words into segments on pauses.
 *
 * Boundaries always land between words, never inside one, which is what keeps
 * every derived span aligned to something that was actually said.
 */
export function buildSegments(words: Word[]): Segment[] {
  const segments: Segment[] = []
  let current: Word[] = []

  const flush = () => {
    if (current.length === 0) return
    segments.push({
      index: segments.length,
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((word) => word.w).join(" "),
      file: current[0].file,
    })
    current = []
  }

  for (const word of words) {
    if (current.length > 0) {
      const previous = current[current.length - 1]
      const brokeOnPause = word.start - previous.end >= PAUSE_SEC
      const brokeOnLength = word.end - current[0].start >= MAX_SEGMENT_SEC
      // A new source file always starts a new segment: two files' clocks are
      // unrelated, so a segment spanning both would have a meaningless span.
      const brokeOnFile = word.file !== previous.file
      if (brokeOnPause || brokeOnLength || brokeOnFile) flush()
    }
    current.push(word)
  }
  flush()

  return segments
}

/** What the agent reads: an index, a timecode, and the words. Nothing else. */
export function renderSegments(segments: Segment[]): string {
  return segments
    .map(
      (segment) => `[${segment.index}] ${clock(segment.start)} ${segment.text}`
    )
    .join("\n")
}

function clock(seconds: number) {
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

/* -------------------------------------------------------------------------- */
/* Windowing                                                                   */
/* -------------------------------------------------------------------------- */

/** Segments per model call. Roughly 40 minutes of speech. */
export const WINDOW_SIZE = 400

/**
 * Overlap between windows.
 *
 * "Redundant with what he said earlier" needs the earlier bit in view. The
 * overlap gives each window a running start; duplicate cuts across the seam are
 * merged in `cutsToSpans`.
 */
export const WINDOW_OVERLAP = 20

export function windowSegments(segments: Segment[]): Segment[][] {
  if (segments.length <= WINDOW_SIZE) return [segments]

  const windows: Segment[][] = []
  const stride = WINDOW_SIZE - WINDOW_OVERLAP
  for (let start = 0; start < segments.length; start += stride) {
    windows.push(segments.slice(start, start + WINDOW_SIZE))
    if (start + WINDOW_SIZE >= segments.length) break
  }
  return windows
}

/* -------------------------------------------------------------------------- */
/* Cuts back to spans                                                          */
/* -------------------------------------------------------------------------- */

/** What the agent returns: a range of segment indices, inclusive. */
export interface CutDecision {
  from: number
  to: number
  category: SpanCategory
  reason: string
}

/**
 * Turns the agent's cut list into a contiguous, tiled span array.
 *
 * "Contiguous" is load-bearing. The clean script is the kept spans
 * concatenated, so any gap between spans is a piece of the talk that silently
 * disappears from the script, the copy, and the chapter list. The postcondition
 * this function guarantees is: spans are sorted, non-overlapping, and cover
 * `[first segment start, last segment end]` exactly.
 */
export function cutsToSpans(cuts: CutDecision[], segments: Segment[]): Span[] {
  if (segments.length === 0) return []

  const ranges = normalizeCuts(cuts, segments.length)
  const spans: Span[] = []
  let cursor = 0

  for (const range of ranges) {
    if (range.from > cursor) {
      spans.push({
        ...bounds(segments, cursor, range.from - 1),
        action: "keep",
      })
    }
    spans.push({
      ...bounds(segments, range.from, range.to),
      action: "cut",
      reason: range.reason,
      category: range.category,
    })
    cursor = range.to + 1
  }

  if (cursor < segments.length) {
    spans.push({
      ...bounds(segments, cursor, segments.length - 1),
      action: "keep",
    })
  }

  return spans
}

/**
 * A span's time range, from its first segment's start to the *next* segment's
 * start.
 *
 * Ending at the last segment's `end` would be the obvious choice and is wrong
 * twice over. It leaves the silence between segments belonging to no span, so
 * the spans no longer tile and the clean script loses every pause. And
 * editorially it's the wrong cut: removing an "um" should take the breath
 * around it too, not leave a hole where the filler was.
 *
 * The final span is the exception — there's no next segment, so it ends where
 * the transcript does.
 */
function bounds(segments: Segment[], from: number, to: number) {
  const next = segments[to + 1]
  return {
    start: segments[from].start,
    end: next ? next.start : segments[to].end,
  }
}

/**
 * Clamps, sorts, drops nonsense, and merges overlaps.
 *
 * Overlaps are expected rather than exceptional: windows share segments, so the
 * same filler gets flagged twice by two different calls. Merging touching or
 * overlapping ranges also keeps the tiling invariant simple — after this, the
 * ranges are disjoint and ascending.
 */
function normalizeCuts(cuts: CutDecision[], segmentCount: number) {
  const clamped = cuts
    .map((cut) => ({
      from: Math.max(0, Math.min(cut.from, cut.to)),
      to: Math.min(segmentCount - 1, Math.max(cut.from, cut.to)),
      category: cut.category,
      reason: cut.reason,
    }))
    .filter((cut) => cut.from <= cut.to && cut.from < segmentCount)
    .sort((a, b) => a.from - b.from)

  const merged: typeof clamped = []
  for (const cut of clamped) {
    const previous = merged[merged.length - 1]
    if (previous && cut.from <= previous.to + 1) {
      previous.to = Math.max(previous.to, cut.to)
      // Keep the first reason. Two windows describing the same cut will phrase
      // it differently, and neither phrasing is more correct.
    } else {
      merged.push({ ...cut })
    }
  }
  return merged
}

/* -------------------------------------------------------------------------- */
/* The approved script                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The segments that survive the cut list.
 *
 * This is what idea.md §3 means by the clean script being "a rendering of the
 * spans marked keep" — it's computed here every time and never stored as text.
 * Crucially, the segments keep their original indices and timings, so a scene
 * placed against this script still points at a real moment in real footage.
 *
 * A segment counts as kept when its midpoint falls inside a keep span. Spans
 * are derived from segment boundaries in the first place, so midpoint testing
 * is exact rather than approximate — it just sidesteps the edge case where a
 * span boundary and a segment boundary are the same number.
 */
export function keptSegments(segments: Segment[], spans: Span[]): Segment[] {
  if (spans.length === 0) return segments

  const cuts = spans.filter((span) => span.action === "cut")
  if (cuts.length === 0) return segments

  return segments.filter((segment) => {
    const midpoint = (segment.start + segment.end) / 2
    return !cuts.some((cut) => midpoint >= cut.start && midpoint < cut.end)
  })
}

/** Plain prose with timecodes, for agents that read rather than point. */
export function renderScript(segments: Segment[]): string {
  return segments
    .map((segment) => `${clock(segment.start)} ${segment.text}`)
    .join("\n")
}

/**
 * Asserts the tiling invariant. Called after every cleanup pass.
 *
 * Cheap, and the failure it catches — a span array with a hole in it — is
 * otherwise invisible until someone notices a paragraph missing from the
 * YouTube description.
 */
export function assertTiles(spans: Span[], segments: Segment[]) {
  if (segments.length === 0) return
  const first = segments[0].start
  const last = segments[segments.length - 1].end

  if (spans.length === 0) {
    throw new Error("cleanup produced no spans for a non-empty transcript")
  }
  if (spans[0].start !== first) {
    throw new Error(
      `spans start at ${spans[0].start}, transcript starts at ${first}`
    )
  }
  if (spans[spans.length - 1].end !== last) {
    throw new Error(
      `spans end at ${spans[spans.length - 1].end}, transcript ends at ${last}`
    )
  }
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start !== spans[i - 1].end) {
      throw new Error(
        `gap or overlap between spans ${i - 1} and ${i}: ${spans[i - 1].end} → ${spans[i].start}`
      )
    }
  }
}
