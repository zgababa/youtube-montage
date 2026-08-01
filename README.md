# B-Roll Pipeline

A locally-run tool for video creators. Point it at a folder of raw footage; it
transcribes, marks up the transcript, decides where b-roll would help, generates
animated HTML scenes, and exports the approved ones as ProRes 4444 with alpha.

The full spec is in [idea.md](idea.md).

## Status

**The UI layer is built. The pipeline is not.**

Every screen is complete and driven by fixtures — no Mastra workflow, no ffmpeg,
no Playwright, no API routes yet.

```bash
npm run dev
```

## Where the pipeline plugs in

[`lib/api.ts`](lib/api.ts) is the only file the UI reads data through. Each
function currently returns a fixture from `lib/mock-data.ts` and maps 1:1 to a
route from §8 of the spec:

| `lib/api.ts` | becomes |
|---|---|
| `listProjects()` | `GET /api/projects` |
| `getProject(id)` | `GET /api/projects/[id]` |
| `getLatestRun(id)` | `GET /api/runs/[id]` |
| `browse(path)` | `GET /api/browse` |

Mutations live in [`components/project/project-workspace.tsx`](components/project/project-workspace.tsx)
and are local to the session. Approvals become `run.resume({ resumeData })` on a
suspended workflow; everything else writes back to `project.json`.

## Layout

```
app/
  page.tsx                    projects grid
  p/[id]/page.tsx             project view
components/
  project/                    header, pipeline progress, cleanup diff,
                              scene list, copy, style guide, shot list
  projects/                   browser (list/card views), row, card,
                              thumbnail, add-project dialog
  scene/scene-frame.tsx       the sandboxed preview iframe
  search-input.tsx            shared search field
  highlight.tsx               wraps matches without altering the text
  ui/                         shadcn components (owned source)
lib/
  types.ts                    project.json + run state shapes
  api.ts                      the seam described above
  project.ts                  derivations — clean script, shot list, counts
  scene-controller.ts         postMessage scrubber injected into previews
  scene-html.ts               sample generated scenes
  mock-data.ts                fixtures
```

## Projects list

Two views, toggled top-right and remembered in localStorage:

- **List** (default) — one row per project: small thumbnail, name, folder path,
  counts and last-opened on the right. Scans quickly down a column.
- **Cards** — the same data as a thumbnail-led grid, 4 across at `xl`.

## Search

Three places, all client-side over data already loaded:

- **Projects grid** — name and folder path.
- **Scene list** — the covered script line first, plus intent, scene id, type,
  source file, and the last regenerate note.
- **Transcript** — narrows the cleanup diff to the spans containing the phrase,
  in script order. Matches are highlighted; the words themselves are untouched,
  and toggling a cut still edits the right span in `project.spans`.

## Scene previews

Scene HTML is never served as a file. It is read server-side, passed as a
string, and dropped into a sandboxed iframe:

```jsx
<iframe sandbox="allow-scripts" srcDoc={html} />
```

`allow-scripts` **without** `allow-same-origin` — generated code must not be
able to reach the app. That also means the page can't touch the iframe's
document, so the scrubber is a small controller injected alongside the scene
([`lib/scene-controller.ts`](lib/scene-controller.ts)) that drives
`document.getAnimations()` over `postMessage` — the same thing the exporter does
when it frame-steps.

A scene that scrubs correctly here is a scene that exports correctly. One that
uses `setTimeout` or `requestAnimationFrame` for timing will look right in
preview and render frozen in the export; the scrubber is what surfaces that.

Previews are mounted only while on screen. A scene preview is a live 1920×1080
document, and a dozen of them at once is enough to stall the compositor.

## Components

All UI comes from shadcn/ui, installed via the CLI into `components/ui/`. This
project uses the **Base UI** primitives (`render`, not `asChild`) and
**hugeicons**. The one deliberate exception is the scene preview `<iframe>`.

```bash
npx shadcn@latest add <component>
```
