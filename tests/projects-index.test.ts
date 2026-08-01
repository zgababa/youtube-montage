import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Redirected before the modules under test are imported, because the path is a
 * module constant evaluated once at load.
 *
 * `VIDEOTOOL_HOME`, not `HOME`: `os.homedir()` reads the system passwd entry,
 * so overriding `HOME` leaves it resolving the developer's real `~/.videotool`
 * — and these tests delete the index file. Ask how I know.
 */
const home = await fs.mkdtemp(path.join(os.tmpdir(), "index-test-"))
process.env.VIDEOTOOL_HOME = path.join(home, ".videotool")

const { addToIndex, findById, readIndex, removeFromIndex, touch } =
  await import("../src/mastra/lib/projects-index")
const { PROJECTS_INDEX } = await import("../src/mastra/lib/paths")

// A belt-and-braces guard. If the override ever stops taking effect, these
// tests must fail loudly rather than quietly wiping a real project list.
if (!PROJECTS_INDEX.startsWith(home)) {
  throw new Error(
    `Refusing to run: PROJECTS_INDEX resolved to ${PROJECTS_INDEX}, outside the test's scratch directory.`
  )
}

async function makeProject(name: string) {
  const dir = path.join(home, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, "project.json"), "{}")
  return dir
}

beforeEach(async () => {
  await fs.rm(PROJECTS_INDEX, { force: true })
})

afterEach(async () => {
  await fs.rm(PROJECTS_INDEX, { force: true })
})

describe("reading", () => {
  test("no file yet is genuinely no projects", async () => {
    expect(await readIndex()).toEqual([])
  })

  /**
   * The failure that cost a real project list. Every writer reads, derives and
   * writes back — so a read that answers "[]" for a corrupt file gets that
   * emptiness *persisted* by the very next write. Opening any project is enough
   * to trigger one.
   */
  test("a corrupt file throws rather than reading as empty", async () => {
    await fs.mkdir(path.dirname(PROJECTS_INDEX), { recursive: true })
    await fs.writeFile(PROJECTS_INDEX, '{"projects": [{"id"')

    await expect(readIndex()).rejects.toThrow(/unreadable/)
  })

  test("a corrupt file cannot be overwritten by a write", async () => {
    const dir = await makeProject("alpha")
    await addToIndex(dir)

    // Simulate the file going bad between one request and the next.
    await fs.writeFile(PROJECTS_INDEX, "not json at all")

    await expect(addToIndex(dir)).rejects.toThrow(/unreadable/)
    // Still the bad bytes, not an empty list written over the top of them.
    expect(await fs.readFile(PROJECTS_INDEX, "utf8")).toBe("not json at all")
  })

  test("touching an unknown id writes nothing", async () => {
    const dir = await makeProject("beta")
    const entry = await addToIndex(dir)
    const before = await fs.readFile(PROJECTS_INDEX, "utf8")

    await touch("no-such-id")

    expect(await fs.readFile(PROJECTS_INDEX, "utf8")).toBe(before)
    expect((await findById(entry.id))?.path).toBe(dir)
  })

  /**
   * Entries used to be dropped on read and the filtered list written back by
   * the next update — so a project on an unplugged drive was forgotten for
   * good. Footage lives on external disks; this has to survive one being out.
   */
  test("an entry whose folder is missing is kept, not forgotten", async () => {
    const dir = await makeProject("gamma")
    const { id } = await addToIndex(dir)

    await fs.rm(dir, { recursive: true, force: true })

    expect(await readIndex()).toHaveLength(1)
    // And a later write doesn't quietly drop it either.
    await addToIndex(await makeProject("delta"))
    expect((await readIndex()).some((e) => e.id === id)).toBe(true)
  })
})

describe("writing", () => {
  test("adds newest first", async () => {
    await addToIndex(await makeProject("one"))
    await addToIndex(await makeProject("two"))

    expect((await readIndex()).map((e) => path.basename(e.path))).toEqual([
      "two",
      "one",
    ])
  })

  test("re-adding the same folder keeps its id and doesn't duplicate", async () => {
    const dir = await makeProject("same")
    const first = await addToIndex(dir)
    const second = await addToIndex(dir)

    expect(second.id).toBe(first.id)
    expect(await readIndex()).toHaveLength(1)
  })

  test("removes an entry and reports what it removed", async () => {
    const dir = await makeProject("doomed")
    const { id } = await addToIndex(dir)

    expect((await removeFromIndex(id))?.path).toBe(dir)
    expect(await readIndex()).toHaveLength(0)
  })

  test("removing twice is a no-op, not a crash", async () => {
    const { id } = await addToIndex(await makeProject("once"))

    await removeFromIndex(id)
    expect(await removeFromIndex(id)).toBeNull()
  })

  test("removing leaves the folder and its project.json alone", async () => {
    const dir = await makeProject("keepme")
    const { id } = await addToIndex(dir)

    await removeFromIndex(id)

    // The whole premise: this forgets a folder, it does not delete footage.
    expect(await fs.readFile(path.join(dir, "project.json"), "utf8")).toBe("{}")
  })

  test("re-adding after removal restores it", async () => {
    const dir = await makeProject("undo")
    const { id } = await addToIndex(dir)
    await removeFromIndex(id)

    const restored = await addToIndex(dir)

    expect(restored.path).toBe(dir)
    expect(await readIndex()).toHaveLength(1)
  })

  /**
   * Adding a project while another request touches a timestamp is ordinary.
   * Unserialized, both derive from the same snapshot and one is discarded —
   * which looks exactly like a project that didn't save.
   */
  test("concurrent writes all survive", async () => {
    const dirs = await Promise.all(
      ["a", "b", "c", "d", "e"].map((n) => makeProject(n))
    )

    await Promise.all(dirs.map((dir) => addToIndex(dir)))

    expect(await readIndex()).toHaveLength(5)
  })

  test("concurrent adds and removes settle consistently", async () => {
    const dirs = await Promise.all(["p", "q", "r"].map((n) => makeProject(n)))
    const entries = await Promise.all(dirs.map((dir) => addToIndex(dir)))

    await Promise.all([
      addToIndex(await makeProject("s")),
      removeFromIndex(entries[0].id),
      touch(entries[1].id),
    ])

    const names = (await readIndex()).map((e) => path.basename(e.path)).sort()
    expect(names).toEqual(["q", "r", "s"])
  })

  test("the file left behind is valid JSON with no temp files beside it", async () => {
    await addToIndex(await makeProject("tidy"))

    const raw = await fs.readFile(PROJECTS_INDEX, "utf8")
    expect(() => JSON.parse(raw)).not.toThrow()

    const leftovers = (await fs.readdir(path.dirname(PROJECTS_INDEX))).filter(
      (name) => name.endsWith(".tmp")
    )
    expect(leftovers).toEqual([])
  })
})
