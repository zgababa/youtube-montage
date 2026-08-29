/**
 * Deciding which files are transcription sources, and which are just footage.
 *
 * The common shooting setup records the same speech twice: a camera capturing
 * its own scratch audio, and a separate mic (or recorder) capturing the good
 * audio. Both land in the project folder, both are media, both have an audio
 * track — and transcribing both puts the entire talk into the script twice.
 *
 * That failure is quiet. The transcript reads as if the speaker repeated
 * themselves, the cleanup agent dutifully marks every filler twice, and the
 * scenes that come back point at the same moment through two different clocks.
 * So the pairing is decided here, once, and shown in the UI where it can be
 * corrected.
 */

import path from "node:path"

import type { MediaFile } from "../schemas"

/**
 * Script order: the order recordings are concatenated into one transcript.
 *
 * Nothing in a file knows when it was recorded — container timestamps are the
 * export time, not the shoot — so the only signal is what the user named
 * things. A `01 - `, `02 - ` prefix is the convention this is built to honour,
 * and two details make it hold:
 *
 *   - **Numeric collation**, so `9` sorts before `10`. Plain string comparison
 *     puts `10 - ` first, which is the classic way a numbered sequence silently
 *     comes out wrong on its tenth entry.
 *   - **Filename before folder**, so `screen/02 - demo` follows
 *     `raw/01 - intro` rather than leading it. Sorting whole paths lets the
 *     directory name outrank the number the user actually typed.
 *
 * Full path breaks ties, so two files with the same name in different folders
 * still order deterministically.
 */
export function compareForScript(a: string, b: string): number {
  const collate = (x: string, y: string) =>
    x.localeCompare(y, undefined, { numeric: true })

  const byName = collate(path.basename(a), path.basename(b))
  return byName !== 0 ? byName : collate(a, b)
}

/**
 * Whether a file is named as a part of the script — `01.MP4`, `02 - demo.mov`.
 *
 * The same convention `compareForScript` sorts by, read as a second claim: a
 * numbered file is a piece of the talk, and by implication an unnumbered one
 * isn't. It's the only statement of intent a folder of footage carries.
 *
 * One to three digits, so a date-named export — `2026-08-03 shoot.mp4` — isn't
 * mistaken for part 2026 of the script.
 */
export function isNumbered(file: string): boolean {
  return /^\d{1,3}(\D|$)/.test(path.basename(file))
}

/**
 * Whether every one of these files carries the numbering convention.
 *
 * A second reading of `isNumbered`, for a caller that already has a specific
 * set of files in hand and wants to know whether the user has explicitly
 * claimed an order over *all* of them — as opposed to `usesNumbering` below,
 * which asks whether the convention is in play at all for a freshly scanned
 * folder (a mix of numbered and unnumbered sources).
 */
export function allNumbered(files: { path: string }[]): boolean {
  return files.every((file) => isNumbered(file.path))
}

/** What ffprobe knows, before any of this is decided. */
export interface ProbedFile {
  path: string
  durationSec: number
  hasAudio: boolean
  hasVideo: boolean
}

/**
 * Fills in `transcribe` / `voices` / `offsetSec` for a freshly scanned folder.
 *
 * `previous` carries settings forward: a re-scan must not discard an offset the
 * user measured by hand, and scanning is the step most likely to be re-run.
 */
export function assignRoles(
  probed: ProbedFile[],
  previous: MediaFile[] = []
): MediaFile[] {
  const before = new Map(previous.map((file) => [file.path, file]))
  const pairing = autoPair(probed)
  const numbered = usesNumbering(probed)

  return probed.map((file): MediaFile => {
    const prior = before.get(file.path)

    // Anything the user has already decided wins outright. Re-deriving it would
    // silently undo their correction on the next run.
    if (prior) {
      return { ...file, ...settingsOf(prior) }
    }

    if (!file.hasAudio) {
      return { ...file, transcribe: false, offsetSec: 0, voices: null }
    }

    if (pairing && file.path === pairing.audio) {
      return { ...file, transcribe: true, offsetSec: 0, voices: pairing.video }
    }

    if (pairing && file.path === pairing.video) {
      return { ...file, transcribe: false, offsetSec: 0, voices: null }
    }

    // The folder says which files are the script. Anything else in it — a
    // screen recording of the same take, a music bed, an unrelated clip — is
    // footage, and transcribing it puts words in the script that were never
    // said in that order.
    if (numbered && !isNumbered(file.path)) {
      return { ...file, transcribe: false, offsetSec: 0, voices: null }
    }

    return { ...file, transcribe: true, offsetSec: 0, voices: null }
  })
}

/**
 * Whether this folder is using the convention at all.
 *
 * The rule has to be conditional. Applied unconditionally to a folder where
 * nothing is numbered it would transcribe nothing, and the run would die at
 * step 2 with no source — a worse failure than the doubled transcript it's
 * there to prevent. It only means anything when the user has numbered *some* of
 * the files, which is what makes the rest of them a deliberate exclusion rather
 * than an accident of naming.
 */
function usesNumbering(files: ProbedFile[]): boolean {
  const sources = files.filter((file) => file.hasAudio)

  return (
    sources.some((file) => isNumbered(file.path)) &&
    sources.some((file) => !isNumbered(file.path))
  )
}

function settingsOf(file: MediaFile) {
  return {
    transcribe: file.transcribe,
    offsetSec: file.offsetSec,
    voices: file.voices,
  }
}

/**
 * The one pairing worth guessing at: exactly one standalone audio file and
 * exactly one video with sound.
 *
 * Deliberately narrow. With two cameras, or a music bed alongside a mic track,
 * there is no single obvious reading — and pairing the wrong two files is worse
 * than pairing none, because the result still looks plausible. Anything
 * ambiguous transcribes everything, which is loud and easy to spot in the UI.
 */
function autoPair(
  files: ProbedFile[]
): { audio: string; video: string } | null {
  const audioOnly = files.filter((file) => file.hasAudio && !file.hasVideo)
  const videoWithSound = files.filter((file) => file.hasAudio && file.hasVideo)

  if (audioOnly.length !== 1 || videoWithSound.length !== 1) return null

  return { audio: audioOnly[0].path, video: videoWithSound[0].path }
}

/**
 * Catches the two ways a saved set of media roles can be internally
 * inconsistent, before it reaches disk.
 *
 * Both are worth refusing rather than storing: a `voices` pointing nowhere
 * silently retags words onto a file the editor doesn't have, and a chain of
 * them has no well-defined anchor at all.
 */
export function checkMediaRoles(media: MediaFile[]): string | null {
  const paths = new Set(media.map((file) => file.path))

  for (const file of media) {
    if (file.voices === null) continue

    if (!paths.has(file.voices)) {
      return `${file.path} is set to voice ${file.voices}, which isn't in this project.`
    }
    if (file.voices === file.path) {
      return `${file.path} can't voice itself.`
    }

    const target = media.find((other) => other.path === file.voices)
    if (target?.voices) {
      return `${file.path} voices ${file.voices}, which voices something else in turn. Point it at the clip you actually scrub.`
    }
  }

  return null
}

/** Human-readable summary of what `assignRoles` decided, for the scan log. */
export function describeRoles(media: MediaFile[]): string[] {
  const lines = media
    .filter((file) => file.hasAudio)
    .map((file) => {
      if (!file.transcribe) return `${file.path} — not transcribed`
      if (file.voices) return `${file.path} — transcribed as ${file.voices}`
      return `${file.path} — transcribed`
    })

  // Said once, up front: a file left out for being unnumbered is the one
  // decision here that looks like something went wrong if you don't know the
  // rule — the file is right there in the folder and nothing transcribed it.
  if (usesNumbering(media)) {
    lines.unshift(
      "Numbered files are the script; unnumbered files default to footage."
    )
  }

  return lines
}

/**
 * Moves a file's words onto the anchor clock.
 *
 * Two things happen at once and both matter: the times shift by `offsetSec`,
 * and the words are re-tagged with the clip they voice. Without the re-tag a
 * scene cut from the mic track would tell the editor to scrub an audio file.
 */
export function anchorWords<
  T extends { start: number; end: number; file: string },
>(words: T[], file: Pick<MediaFile, "path" | "offsetSec" | "voices">): T[] {
  const target = file.voices ?? file.path

  if (file.offsetSec === 0 && target === file.path) return words

  return words.map((word) => ({
    ...word,
    start: word.start + file.offsetSec,
    end: word.end + file.offsetSec,
    file: target,
  }))
}
