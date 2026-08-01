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

import type { MediaFile } from "../schemas"

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

    return { ...file, transcribe: true, offsetSec: 0, voices: null }
  })
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

/** Human-readable summary of what `assignRoles` decided, for the scan log. */
export function describeRoles(media: MediaFile[]): string[] {
  return media
    .filter((file) => file.hasAudio)
    .map((file) => {
      if (!file.transcribe) return `${file.path} — not transcribed`
      if (file.voices) return `${file.path} — transcribed as ${file.voices}`
      return `${file.path} — transcribed`
    })
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
