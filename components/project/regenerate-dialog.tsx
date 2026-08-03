"use client"

import * as React from "react"

import { durationLabel } from "@/lib/format"
import type { Scene } from "@/lib/types"
import { SCENE_MODEL, SCENE_MODELS } from "@/src/mastra/models"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

interface RegenerateDialogProps {
  scene: Scene
  trigger: React.ReactElement
  onSubmit: (note: string, model: string) => void
}

const MODEL_ITEMS = SCENE_MODELS.map((model) => ({
  value: model.id,
  label: model.label,
}))

/**
 * Regenerate-with-note: the note is appended to the scene agent's prompt, and
 * the model is the one that writes it.
 *
 * The model belongs here rather than in project settings because it is a
 * property of one attempt, not of the project. A scene that has come back
 * wrong twice is the reason to reach for a slower model, and it would be
 * wasteful to move the other eleven onto it too.
 */
export function RegenerateDialog({
  scene,
  trigger,
  onSubmit,
}: RegenerateDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState(scene.note ?? "")
  // Whatever wrote the current version, so the default action is "the same
  // again, with a note" and changing the model is a deliberate second step.
  const [model, setModel] = React.useState(scene.model ?? SCENE_MODEL)

  const chosen = SCENE_MODELS.find((entry) => entry.id === model)

  function submit() {
    onSubmit(note.trim(), model)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate {scene.id}</DialogTitle>
          <DialogDescription>
            Runs the scene agent again with the same style guide and the same{" "}
            {durationLabel(scene.windowSec)} window.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`note-${scene.id}`}>Note</FieldLabel>
            <Textarea
              id={`note-${scene.id}`}
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Slower. Drop the third panel and let the second one breathe."
            />
            <FieldDescription>
              Appended to the prompt. The window, palette, and motion rules stay
              fixed.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`model-${scene.id}`}>Model</FieldLabel>
            <Select
              items={MODEL_ITEMS}
              value={model}
              onValueChange={(value) => setModel(value as string)}
            >
              <SelectTrigger id={`model-${scene.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MODEL_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              {chosen?.note ?? "Writes this scene only."}
            </FieldDescription>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button onClick={submit}>Regenerate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
