"use client"

import * as React from "react"

import type { TranscriptionHints } from "@/lib/types"
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"

/** AssemblyAI's limits, mirrored so the UI can warn before the save fails. */
const MAX_KEYTERM_WORDS = 1000
const MAX_WORDS_PER_PHRASE = 6

/**
 * Two hints handed to the transcriber before it starts.
 *
 * Worth the field because a transcription error doesn't stay one. Every asset
 * downstream — the b-roll briefs, the YouTube description, the thread — is a
 * rewrite of this text, so a library name heard wrong comes back as a confident
 * misspelling in all of them. Fixing it at the source is the only cheap fix.
 */
export function TranscriptionHintsEditor({
  hints,
  locked,
  onSave,
}: {
  hints: TranscriptionHints
  /** True once a transcript exists — changing these won't retranscribe it. */
  locked: boolean
  onSave: (next: TranscriptionHints) => void
}) {
  const [prompt, setPrompt] = React.useState(hints.prompt)
  const [keyterms, setKeyterms] = React.useState(() =>
    hints.keyterms.join("\n")
  )

  const [seen, setSeen] = React.useState(hints)
  if (seen !== hints) {
    setSeen(hints)
    setPrompt(hints.prompt)
    setKeyterms(hints.keyterms.join("\n"))
  }

  const terms = splitTerms(keyterms)
  const next: TranscriptionHints = { prompt, keyterms: terms }
  const dirty = JSON.stringify(next) !== JSON.stringify(hints)

  const overLong = terms.filter(
    (term) => term.split(/\s+/).length > MAX_WORDS_PER_PHRASE
  )
  const wordCount = terms.reduce(
    (total, term) => total + term.split(/\s+/).length,
    0
  )
  const problem =
    overLong.length > 0
      ? `${overLong.length} entr${overLong.length === 1 ? "y is" : "ies are"} longer than ${MAX_WORDS_PER_PHRASE} words — those belong in the description above.`
      : wordCount > MAX_KEYTERM_WORDS
        ? `${wordCount} words, over the ${MAX_KEYTERM_WORDS} limit. Terms past it stop having any effect.`
        : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transcription hints</CardTitle>
        <CardDescription>
          Told to the transcriber before it starts. Names it hasn&rsquo;t got
          context for — libraries, products, people — are what it guesses wrong,
          and every asset generated afterwards repeats the guess.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="hint-prompt">What this is about</FieldLabel>
            <Textarea
              id="hint-prompt"
              rows={3}
              value={prompt}
              placeholder="A walkthrough of building an agent pipeline with Mastra and the Vercel AI SDK, aimed at TypeScript developers."
              onChange={(event) => setPrompt(event.target.value)}
            />
            <FieldDescription>
              Describe the recording, not how to transcribe it — formatting and
              behavioural instructions are ignored. The model stays grounded in
              the audio, so extra context can&rsquo;t invent words.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="hint-keyterms">
              Names and terms
              {terms.length > 0 ? (
                <Badge variant="secondary">{terms.length}</Badge>
              ) : null}
            </FieldLabel>
            <Textarea
              id="hint-keyterms"
              rows={6}
              value={keyterms}
              placeholder={"Mastra\nLibSQL\nProRes 4444\nAssemblyAI"}
              onChange={(event) => setKeyterms(event.target.value)}
              aria-invalid={problem !== null}
              className="font-mono text-xs"
            />
            <FieldDescription>
              {problem ? (
                <span className="text-destructive">{problem}</span>
              ) : (
                <>
                  One per line. Exact spellings you want back — short phrases,
                  not sentences.
                </>
              )}
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>

      <CardFooter className="flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {locked
            ? "This project already has a transcript — these apply the next time transcription runs."
            : "Applied when transcription runs."}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setPrompt(hints.prompt)
              setKeyterms(hints.keyterms.join("\n"))
            }}
            disabled={!dirty}
          >
            Reset
          </Button>
          <Button
            onClick={() => onSave(next)}
            disabled={!dirty || problem !== null}
          >
            Save hints
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}

/** One per line, blanks and stray whitespace dropped. */
function splitTerms(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
}
