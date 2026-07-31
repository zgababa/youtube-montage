"use client"

import * as React from "react"

import { durationLabel } from "@/lib/format"
import type { Scene } from "@/lib/types"
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
import { Textarea } from "@/components/ui/textarea"

interface RegenerateDialogProps {
  scene: Scene
  trigger: React.ReactElement
  onSubmit: (note: string) => void
}

/** Regenerate-with-note: the note is appended to the scene agent's prompt. */
export function RegenerateDialog({
  scene,
  trigger,
  onSubmit,
}: RegenerateDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState(scene.note ?? "")

  function submit() {
    onSubmit(note.trim())
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
        </FieldGroup>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={submit}>Regenerate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
