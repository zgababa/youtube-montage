# Glossary

This fork introduces a dedicated `docs/adr/` and this glossary — see
`docs/adr/0001-export-fcpxml-plutot-que-edl.md` for why. One definition per
term, opinionated where two words compete for the same concept.

## Segment

A group of consecutive words from one source file, split on a long pause, a
length ceiling, or a change of file — whichever comes first. Segments are the
unit the cleanup agent reasons about: it never sees raw word timings, only
numbered segments (`idea.md` §3's rule against handing a model precise
timestamps to echo back).

Defined by `buildSegments` in `src/mastra/lib/segments.ts`.

## Span

A decision — `keep` or `cut` — over a contiguous range of the transcript, with
a category and reason when it's a cut. Spans tile the whole transcript exactly
(no gaps, no overlaps): every second of source footage belongs to exactly one
span. The clean script is nothing but the kept spans, concatenated.

Defined by `SpanSchema` in `src/mastra/schemas.ts`; produced from cut
decisions by `cutsToSpans` in `src/mastra/lib/segments.ts`.

## Run

A contiguous stretch of **one physical source file** that survives the cuts —
the unit the FCPXML export chains into the timeline's spine. Two kept
segments only merge into one run when they're from the same file *and*
nothing between them was cut; a file boundary always starts a new run, even
when nothing was cut at the seam.

Defined by `buildKeptRuns` in `src/mastra/lib/timeline.ts`.

**Avoid confusing this with "pipeline run"** — a single execution of the
Mastra workflow, identified by `runId` (see `src/mastra/stream/contract.ts`,
`GateSchema`, the `run` and `gate` event schemas). Both terms are in active
use in this codebase and nothing about the spelling distinguishes them. When
it matters, prefer **"timeline run"** for this glossary's `run` and
**"pipeline run"** or **"workflow run"** for the Mastra one; this glossary
entry is `run` unqualified only because `TimelineRun` is the type name in
code.
