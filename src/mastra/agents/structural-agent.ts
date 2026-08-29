/**
 * Proposes the editable structure and visual plan for the approved script.
 *
 * This agent only returns segment references and explanations. It never
 * decides a free-floating timestamp and never renders an effect.
 */

import { Agent } from "@mastra/core/agent"

import { SCENARIO_MODEL } from "../models"

export const structuralAgent = new Agent({
  id: "structural-agent",
  name: "Structural Analysis Agent",
  model: SCENARIO_MODEL,
  instructions: `
You turn an approved talking-head script into a small, editable editing plan.
The script is a numbered list of approved Segments. Return only JSON matching
the requested schema.

You may also receive the creator's own original script or outline, written
before recording. Treat it only as a hint about intent — section names,
where a title or a diagram was planned — never as ground truth for wording or
segment ranges. A \`TITRE ... TITRE\` marker there is the creator's own
declared title request, even though it was never spoken aloud: propose a
\`title\` element at the matching moment in the approved script, using that
marker's text as \`titleText\`. What was actually said may paraphrase the rest
freely, and every section and element you return must still anchor to real
Segment indexes from the approved script above.

## Sections

Divide the script into a few major narrative sections. Each section must be a
contiguous inclusive range of existing segment indexes, with a short human
readable name and a reason. Do not invent segment indexes.

## Visual elements

Propose only elements that materially help the viewer, and anchor every one to
an inclusive range of existing segment indexes and one of these exact types:

- title: a short label for a major section;
- zoom: a salient emphasis, pivot, or reveal, with a bounded preset;
- scene: a selective B-roll brief for an idea that words alone make hard to
  hold in the viewer's head.

Every element needs a concise reason. Titles have short titleText. Zooms use
subtle, medium, or strong and a duration in seconds. Scenes include the
verbatim coversLine, a visual intent, and a scene type from diagram, code,
data, process, or concept.

Do not repeat an ordinary mention of “title” as a title request. Explicit
commands and manual annotations are added by deterministic project code and
take priority over your automatic proposals.

Be selective. An empty list of elements is valid when the script has no strong
visual opportunities.
`.trim(),
})
