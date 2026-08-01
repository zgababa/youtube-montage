"use client"

import * as React from "react"

import { durationLabel } from "@/lib/format"
import type { MediaFile } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

function offsetText(media: MediaFile[]): Record<string, string> {
  return Object.fromEntries(
    media.map((file) => [file.path, String(file.offsetSec)])
  )
}

/**
 * Seconds, or null if what's typed isn't a number yet.
 *
 * Accepts a comma decimal separator: the field is filled by reading a number
 * off an NLE, and on a comma-locale keyboard that's what gets typed.
 */
function parseOffset(text: string | undefined): number | null {
  const trimmed = (text ?? "").trim().replace(",", ".")
  if (trimmed === "" || trimmed === "-") return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/**
 * Which files are transcribed, and how a separate audio recording lines up.
 *
 * This exists for the ordinary two-recorder setup: a camera capturing its own
 * scratch audio while a mic captures the good audio. Both are media, both have
 * sound, and transcribing both puts the whole talk in the script twice. Scan
 * guesses the pairing when it's unambiguous; this is where the guess is checked
 * and the sync offset — which nothing can guess — is entered.
 */
export function MediaSettings({
  media,
  onSave,
}: {
  media: MediaFile[]
  onSave: (next: MediaFile[]) => void
}) {
  const [draft, setDraft] = React.useState(media)
  /**
   * Offsets are edited as text, not as numbers.
   *
   * A controlled numeric input can't hold the intermediate states of typing one
   * — "-", "-8." and, in a comma-decimal locale, "-8,2" all read back as the
   * empty string. Parsing on every keystroke would turn each of those into 0
   * and fight the user mid-edit, silently discarding the sync they measured.
   */
  const [offsets, setOffsets] = React.useState(() => offsetText(media))

  // Re-syncs when a run rewrites the media list, which `scan` does every time.
  const [seen, setSeen] = React.useState(media)
  if (seen !== media) {
    setSeen(media)
    setDraft(media)
    setOffsets(offsetText(media))
  }

  const parsed = draft.map((file) => ({
    ...file,
    offsetSec: parseOffset(offsets[file.path]) ?? file.offsetSec,
  }))

  const invalid = draft.filter(
    (file) => parseOffset(offsets[file.path]) === null
  )
  const dirty = JSON.stringify(parsed) !== JSON.stringify(media)
  const sources = parsed.filter((file) => file.hasAudio && file.transcribe)

  function set(path: string, next: Partial<MediaFile>) {
    setDraft((current) =>
      current.map((file) => (file.path === path ? { ...file, ...next } : file))
    )
  }

  /** Clips a file can be the audio for: anything else with a video stream. */
  const anchors = draft.filter((file) => file.hasVideo)

  if (media.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Media</CardTitle>
          <CardDescription>
            Nothing scanned yet. Run the pipeline and the folder&rsquo;s video
            and audio files show up here.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Media</CardTitle>
        <CardDescription>
          Transcribe one source per performance. If a camera and a separate mic
          both recorded the same talk, transcribing both puts it in the script
          twice — pick the mic, and tell it which clip it belongs to.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {draft.map((file) => (
          <div
            key={file.path}
            className="flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm">{file.path}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {durationLabel(file.durationSec)}
                  {" · "}
                  {file.hasVideo ? "video" : "audio only"}
                  {file.hasAudio ? "" : " · no sound"}
                </p>
              </div>

              {file.hasAudio ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Label
                    htmlFor={`transcribe-${file.path}`}
                    className="text-xs font-normal"
                  >
                    Transcribe
                  </Label>
                  <Switch
                    id={`transcribe-${file.path}`}
                    checked={file.transcribe}
                    onCheckedChange={(checked) =>
                      set(file.path, {
                        transcribe: checked,
                        // Pointing at a clip is meaningless for a file whose
                        // words never enter the transcript.
                        ...(checked ? {} : { voices: null }),
                      })
                    }
                  />
                </div>
              ) : (
                <Badge variant="secondary">footage only</Badge>
              )}
            </div>

            {file.hasAudio && file.transcribe ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={`voices-${file.path}`}
                    className="text-xs font-normal"
                  >
                    Audio for
                  </Label>
                  <Select
                    value={file.voices ?? ""}
                    onValueChange={(value) =>
                      set(file.path, {
                        voices: value === "" ? null : (value as string),
                      })
                    }
                  >
                    <SelectTrigger id={`voices-${file.path}`}>
                      <SelectValue placeholder="Itself" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Itself</SelectItem>
                      {anchors
                        .filter((clip) => clip.path !== file.path)
                        .map((clip) => (
                          <SelectItem key={clip.path} value={clip.path}>
                            {clip.path}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Scenes report the clip you scrub, not the file transcribed.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={`offset-${file.path}`}
                    className="text-xs font-normal"
                  >
                    Sync offset (seconds)
                  </Label>
                  <Input
                    id={`offset-${file.path}`}
                    inputMode="decimal"
                    value={offsets[file.path] ?? "0"}
                    onChange={(event) =>
                      setOffsets((current) => ({
                        ...current,
                        [file.path]: event.target.value,
                      }))
                    }
                    aria-invalid={parseOffset(offsets[file.path]) === null}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    {parseOffset(offsets[file.path]) === null ? (
                      <span className="text-destructive">
                        Not a number of seconds.
                      </span>
                    ) : (
                      <>
                        Negative if this started recording first. A mic rolling
                        8.2s before the camera is{" "}
                        <span className="font-mono">-8.2</span>.
                      </>
                    )}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>

      <CardFooter className="flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {sources.length === 0
            ? "No transcription source — the run will stop at step 2."
            : `${sources.length} source${sources.length === 1 ? "" : "s"} will be transcribed.`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setDraft(media)
              setOffsets(offsetText(media))
            }}
            disabled={!dirty}
          >
            Reset
          </Button>
          <Button
            onClick={() => onSave(parsed)}
            disabled={!dirty || invalid.length > 0}
          >
            Save media settings
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
