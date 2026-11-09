import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Button } from '../../../components/ui/Button'
import { createTemplateFn, getTemplatesFn } from '../../../server/functions'
import { TemplateThumbnail } from '../../templates/components/TemplateThumbnail'
import { queryKeys } from '../../../queryKeys'

interface SaveTemplateDialogProps {
  isOpen: boolean
  onClose: () => void
  /** Compiled HTML of the design, read at save time so it matches the canvas. */
  getHtml: () => string
  defaultName: string
  /** The template being edited, if it is one: this saves a new one beside it. */
  editingTemplate?: string
}

export function SaveTemplateDialog({ isOpen, onClose, getHtml, defaultName, editingTemplate }: SaveTemplateDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState('')
  const { data: existing = [] } = useQuery({ queryKey: queryKeys.templates.list(), queryFn: () => getTemplatesFn(), enabled: isOpen })
  const taken = existing.some(t => t.name.trim().toLowerCase() === name.trim().toLowerCase())
  // The design as it stands, for the picture: the dialog is mounted afresh each time it opens.
  const [html] = useState(getHtml)

  const save = useMutation({
    mutationFn: () => createTemplateFn({ data: { name, description, html: getHtml() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates.list() })
      setDescription('')
      onClose()
    },
  })

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={editingTemplate ? 'Save as new template' : 'Save as template'}
      description={editingTemplate ? `“${editingTemplate}” stays as it is.` : 'Keep this design to start new emails from.'}
      className="sm:max-w-lg"
    >
      <form
        className="flex min-h-0 flex-col"
        onSubmit={e => {
          e.preventDefault()
          if (name.trim()) save.mutate()
        }}
      >
        <DialogBody>
          <div className="flex gap-4">
            <TemplateThumbnail html={html} inset={6} className="aspect-[4/5] w-24 shrink-0 rounded-md-s border border-border max-sm:hidden dark:border-white/10" />
            <div className="min-w-0 flex-1 space-y-4">
              <Field label="Name" hint={taken ? 'You already have a template with this name.' : undefined}>
                <input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} onFocus={e => e.currentTarget.select()} className={INPUT_CLASS} />
              </Field>
              <Field label={<>Description <span className="font-normal text-muted-foreground">(optional)</span></>} hint="Shown on the template's card.">
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={`${INPUT_CLASS} resize-none`} />
              </Field>
            </div>
          </div>
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
