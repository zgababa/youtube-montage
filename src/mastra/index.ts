/**
 * The Mastra instance.
 *
 * Imported in-process by the Next route handlers and loaded by `mastra dev`
 * for Studio. Both point at the same LibSQL file, so a run started from the app
 * is inspectable in Studio and vice versa — that's the debugging surface
 * idea.md §9 asks for.
 *
 * Nothing under `src/mastra/` imports from `next`. The workflow has to run
 * headless from Studio and from a plain script, which is how the exporter gets
 * debugged without clicking through a browser (idea.md §8).
 */

import fs from "node:fs"
import { Mastra } from "@mastra/core"
import { LibSQLStore } from "@mastra/libsql"

import { cleanupAgent } from "./agents/cleanup-agent"
import { copyAgent } from "./agents/copy-agent"
import { scenarioAgent } from "./agents/scenario-agent"
import { sceneAgent } from "./agents/scene-agent"
import { APP_DIR, MASTRA_DB_URL } from "./lib/paths"
import { brollWorkflow } from "./workflows/broll-workflow"
import { generateSceneWorkflow } from "./workflows/generate-scene-workflow"

// LibSQL won't create the directory itself, and `~/.videotool` doesn't exist on
// a fresh machine.
fs.mkdirSync(APP_DIR, { recursive: true })

export const mastra = new Mastra({
  workflows: { brollWorkflow, generateSceneWorkflow },
  agents: { cleanupAgent, scenarioAgent, sceneAgent, copyAgent },

  /**
   * Run state only — which step is executing, suspended payloads, snapshots.
   * Disposable: losing this file costs a re-run and nothing else, because every
   * step writes its deliverables to the project folder before returning.
   *
   * An absolute path outside the Next project on purpose. Relative paths
   * resolve differently between the Next process and Studio, and a database
   * inside a project folder would travel with a folder that's meant to be
   * portable.
   */
  storage: new LibSQLStore({
    id: "videotool-runs",
    url: MASTRA_DB_URL,
  }),

  bundler: {
    /**
     * `mastra dev` bundles this directory. These three can't be bundled:
     * Playwright resolves browser binaries relative to its own install,
     * `@libsql/client` loads a native addon, and the AssemblyAI SDK reaches
     * for Node builtins to stream file uploads.
     */
    externals: [
      "playwright",
      "playwright-core",
      "@libsql/client",
      "assemblyai",
    ],
  },
})
