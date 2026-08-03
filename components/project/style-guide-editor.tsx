"use client"

import * as React from "react"

import type { StyleGuide } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { StageSection } from "@/components/project/stage"

/**
 * One style guide per project, passed to every scene agent. Without it,
 * parallel agents produce visually inconsistent scenes (idea.md §5).
 */
export function StyleGuideEditor({
  styleGuide,
  onSave,
}: {
  styleGuide: StyleGuide
  onSave: (next: StyleGuide) => void
}) {
  const [draft, setDraft] = React.useState(styleGuide)

  const dirty = JSON.stringify(draft) !== JSON.stringify(styleGuide)

  function set<K extends keyof StyleGuide>(key: K, value: StyleGuide[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  return (
    <StageSection
      description={
        <>
          Stored in <span className="font-mono">project.json</span>. Editing it
          only affects scenes generated from here on.
        </>
      }
      footer={
        <>
          <span />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setDraft(styleGuide)}
              disabled={!dirty}
            >
              Reset
            </Button>
            <Button onClick={() => onSave(draft)} disabled={!dirty}>
              Save style guide
            </Button>
          </div>
        </>
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="palette">Palette</FieldLabel>
          <div className="flex items-center gap-3">
            <div className="flex shrink-0 items-center gap-1.5">
              {draft.palette.map((color) => (
                <span
                  key={color}
                  className="size-7 rounded-full border"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
            <Input
              id="palette"
              value={draft.palette.join(", ")}
              onChange={(event) =>
                set(
                  "palette",
                  event.target.value
                    .split(",")
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                )
              }
              className="font-mono text-xs"
            />
          </div>
          <FieldDescription>
            Comma separated. Background, foreground, then accents.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="font-stack">Font stack</FieldLabel>
          <Input
            id="font-stack"
            value={draft.fontStack}
            onChange={(event) => set("fontStack", event.target.value)}
            className="font-mono text-xs"
          />
          <FieldDescription>
            System fonts only — scenes make no external requests.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="motion">Motion character</FieldLabel>
          <Input
            id="motion"
            value={draft.motion}
            onChange={(event) => set("motion", event.target.value)}
          />
          <FieldDescription>
            Rendered frames have no motion blur, so fast movement strobes
            against real footage. Keep it slow and heavily eased.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="notes">Notes</FieldLabel>
          <Textarea
            id="notes"
            rows={3}
            value={draft.notes}
            onChange={(event) => set("notes", event.target.value)}
          />
        </Field>
      </FieldGroup>
    </StageSection>
  )
}
