import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '../../../components/ui/Dialog'
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
    <Dialog isOpen={isOpen} onClose={onClose} title="Save as template" className="max-w-md">
      <form
        className="p-6 space-y-4"
        onSubmit={e => {
          e.preventDefault()
          if (name.trim()) save.mutate()
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Name</span>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Description (optional)</span>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
        </label>
        {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" isLoading={save.isPending} disabled={!name.trim()}>
            Save template
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
