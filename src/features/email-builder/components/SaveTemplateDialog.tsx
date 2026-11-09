import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Button } from '../../../components/ui/Button'
import { createTemplateFn } from '../../../server/functions'
import { queryKeys } from '../../../queryKeys'

interface SaveTemplateDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Compiled HTML of the design, read at save time so it matches the canvas. */
  getHtml: () => string
  defaultName: string
}

export function SaveTemplateDialog({ isOpen, onClose, getHtml, defaultName }: SaveTemplateDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState('')

  const save = useMutation({
    mutationFn: () => createTemplateFn({ data: { name, description, html: getHtml() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates.list() })
      setDescription('')
      onClose()
    },
  })

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Save as template" description="Keep this design to start new campaigns from." className="sm:max-w-md">
      <form
        className="flex min-h-0 flex-col"
        onSubmit={e => {
          e.preventDefault()
          if (name.trim()) save.mutate()
        }}
      >
        <DialogBody className="space-y-4">
          <Field label="Name">
            <input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={INPUT_CLASS} />
          </Field>
          <Field label={<>Description <span className="font-normal text-muted-foreground">(optional)</span></>} hint="Shown on the template's card.">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={`${INPUT_CLASS} resize-none`} />
          </Field>
        </DialogBody>
        <DialogFooter>
          {save.error && <p className="text-[13px] text-destructive sm:mr-auto">{save.error.message}</p>}
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={save.isPending}>
            Save template
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
