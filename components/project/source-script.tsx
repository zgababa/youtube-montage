"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { StageSection } from "@/components/project/stage"

/**
 * The creator's own script or outline, written before recording.
 *
 * Never the transcript, and never treated as one: what's actually said may
 * paraphrase this freely. It's read-only context handed to the structural
 * analysis, so the model can recognise the sections, titles and diagrams the
 * creator already had in mind even when the wording on screen drifts from
 * what was spoken — see `structuralAgent`'s instructions.
 */
export function SourceScriptEditor({
  sourceScript,
  onSave,
}: {
  sourceScript: string | null
  onSave: (next: string | null) => void
}) {
  const [text, setText] = React.useState(sourceScript ?? "")

  const [seen, setSeen] = React.useState(sourceScript)
  if (seen !== sourceScript) {
    setSeen(sourceScript)
    setText(sourceScript ?? "")
  }

  const next = text.trim().length > 0 ? text : null
  const dirty = next !== sourceScript

  return (
    <StageSection
      title="Original script"
      description="Your own draft or teleprompter script, if you have one. Used as context for the structural analysis — never as the transcript, and never rewritten to match it."
      footer={
        <>
          <p className="text-xs text-muted-foreground">
            Optional. Helps the analysis recognise your intended sections,
            titles and diagrams even where the recording paraphrases this.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setText(sourceScript ?? "")}
              disabled={!dirty}
            >
              Reset
            </Button>
            <Button onClick={() => onSave(next)} disabled={!dirty}>
              Save script
            </Button>
          </div>
        </>
      }
    >
      <FieldGroup>
        <Field>
          <Textarea
            id="source-script"
            rows={10}
            value={text}
            placeholder={
              "First, I'll cover... TITRE The architecture TITRE ... then a diagram of..."
            }
            onChange={(event) => setText(event.target.value)}
            className="font-mono text-xs"
          />
          <FieldDescription>
            Paste it as written — mention where you plan a TITRE or a diagram
            if you already know. Paraphrasing on camera is fine; this never
            has to match the recording word for word.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </StageSection>
  )
}
