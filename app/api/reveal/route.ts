/**
 * Shows a path in the OS file manager.
 *
 * The pipeline's output is files on disk — `.mov`s and a shot list — so the
 * useful last step of a run is getting the user to them.
 */

import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const { path: target } = (await request.json()) as { path?: string }

  if (!target) {
    return Response.json({ error: "path is required" }, { status: 400 })
  }

  const resolved = path.resolve(target)

  try {
    await fs.access(resolved)
  } catch {
    return Response.json(
      { error: `${resolved} does not exist` },
      { status: 404 }
    )
  }

  const command = revealCommand(resolved)
  if (!command) {
    return Response.json(
      { error: `Revealing files isn't supported on ${process.platform}` },
      { status: 501 }
    )
  }

  // Detached and unreferenced: the file manager outliving this request is the
  // point, and waiting on it would hold the response open.
  spawn(command[0], command.slice(1), {
    detached: true,
    stdio: "ignore",
  }).unref()

  return Response.json({ ok: true })
}

function revealCommand(target: string): string[] | null {
  switch (process.platform) {
    case "darwin":
      return ["open", "-R", target]
    case "win32":
      return ["explorer", `/select,${target}`]
    case "linux":
      // No universal "select this file", so open the containing folder.
      return ["xdg-open", path.dirname(target)]
    default:
      return null
  }
}
