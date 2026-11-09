import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowLeft, Copy, LayoutTemplate, Pencil, Plus, Send, Trash2, Type } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import {
  createTemplateFn,
  deleteTemplateFn,
  duplicateTemplateFn,
  getTemplatesFn,
  updateTemplateFn,
} from '../../../server/functions'
import { STARTER_TEMPLATES } from '../../../features/email-builder/templates/starters'
import { TemplateThumbnail } from '../../../features/templates/components/TemplateThumbnail'
import type { EmailTemplate } from '../../../features/templates/types'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { confirmDialog } from '../../../components/ui/confirm'
import { toast } from '../../../components/ui/toast'

export const Route = createFileRoute('/marketing/templates/')({
  component: TemplatesPage,
})

function TemplatesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [renaming, setRenaming] = useState<EmailTemplate | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: queryKeys.templates.list(),
    queryFn: () => getTemplatesFn(),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.templates.list() })

  const openBuilder = (id: string) =>
    navigate({ to: '/marketing/templates/$templateId/edit', params: { templateId: id } })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; starterId?: string }) => createTemplateFn({ data }),
    onSuccess: template => {
      invalidate()
      setShowCreate(false)
      openBuilder(template.id)
    },
  })

  const renameMutation = useMutation({
    mutationFn: (data: { id: string; name: string; description: string }) => updateTemplateFn({ data }),
    onSuccess: () => {
      invalidate()
      setRenaming(null)
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateTemplateFn({ data: { id } }),
    onSuccess: () => {
      invalidate()
      toast.success('Template duplicated')
    },
    onError: (err: Error) => toast.error("Couldn't duplicate the template", { description: err.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTemplateFn({ data: { id } }),
    onSuccess: () => {
      invalidate()
      toast.success('Template deleted')
    },
    onError: (err: Error) => toast.error("Couldn't delete the template", { description: err.message }),
  })

  const rename = (template: EmailTemplate) => {
    renameMutation.reset()
    setRenaming(template)
  }

  const confirmDelete = async (template: EmailTemplate) => {
    const ok = await confirmDialog({
      title: `Delete “${template.name}”?`,
      message: "Campaigns made from it aren't affected. This can't be undone.",
      confirmLabel: 'Delete template',
      tone: 'danger',
    })
    if (ok) deleteMutation.mutate(template.id)
  }

  // Take over the page rather than opening a modal, as the Surveys page does.
  if (showCreate) {
    return (
      <CreateTemplateView
        onClose={() => setShowCreate(false)}
        onCreate={data => createMutation.mutate(data)}
        isSaving={createMutation.isPending}
        error={createMutation.error?.message}
      />
    )
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="flex justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-2">Templates</h1>
          <p className="text-muted-foreground">
            Reusable email designs. Start campaigns from them, or apply them from the builder's Saved tab.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md-s font-medium hover:bg-primary/85 active:scale-95 transition-all flex items-center gap-2 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card animate-pulse h-72 border border-border rounded-md-m" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mb-4">
            <LayoutTemplate className="w-8 h-8 text-accent" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">No templates yet</h3>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Design one from a starter layout, or open any campaign in the builder and choose "Save as template".
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md-s font-medium hover:bg-primary/85 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Create Template
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map(template => (
            <div
              key={template.id}
              className="card border border-border rounded-md-m overflow-hidden flex flex-col cursor-pointer hover:border-accent/50 transition-colors"
              onClick={() => openBuilder(template.id)}
            >
              <TemplateThumbnail html={template.html} />
              <div className="p-4 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-foreground truncate">{template.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      updated {new Date(template.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <IconButton title="Edit" onClick={() => openBuilder(template.id)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </IconButton>
                    <IconButton title="Rename" onClick={() => rename(template)}>
                      <Type className="w-3.5 h-3.5" />
                    </IconButton>
                    <IconButton title="Duplicate" onClick={() => duplicateMutation.mutate(template.id)}>
                      <Copy className="w-3.5 h-3.5" />
                    </IconButton>
                    <IconButton title="Delete" danger onClick={() => confirmDelete(template)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconButton>
                  </div>
                </div>
                {template.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{template.description}</p>
                )}
                <button
                  onClick={e => {
                    e.stopPropagation()
                    navigate({ to: '/marketing/campaigns', search: { template: template.id } })
                  }}
                  className="mt-auto flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md-s border border-border hover:bg-muted text-foreground cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" /> Use in campaign
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {renaming && (
        <RenameTemplateDialog
          key={renaming.id}
          template={renaming}
          onClose={() => setRenaming(null)}
          onSave={(name, description) => renameMutation.mutate({ id: renaming.id, name, description })}
          isSaving={renameMutation.isPending}
          error={renameMutation.error?.message}
        />
      )}
    </div>
  )
}

function IconButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={e => {
        e.stopPropagation()
        onClick()
      }}
      className={`p-1.5 rounded-md-s text-muted-foreground transition-colors cursor-pointer ${
        danger ? 'hover:text-destructive hover:bg-destructive/10' : 'hover:text-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  )
}

function CreateTemplateView({
  onClose,
  onCreate,
  isSaving,
  error,
}: {
  onClose: () => void
  onCreate: (data: { name: string; starterId?: string }) => void
  isSaving: boolean
  error?: string
}) {
  const [name, setName] = useState('')
  const [starterId, setStarterId] = useState<string | undefined>(undefined)
  const categories = [...new Set(STARTER_TEMPLATES.map(t => t.category))]

  const create = (id: string | undefined) => {
    const starter = STARTER_TEMPLATES.find(t => t.id === id)
    onCreate({ name: name.trim() || starter?.name || 'Untitled template', starterId: id })
  }

  const optionClass = (selected: boolean) =>
    `card text-left p-5 rounded-md-m border transition-colors cursor-pointer flex flex-col gap-2 ${
      selected ? 'border-accent ring-1 ring-accent bg-accent/5' : 'border-border hover:border-accent/50'
    }`

  return (
    <form
      className="p-4 lg:p-8 max-w-5xl"
      onSubmit={e => {
        e.preventDefault()
        create(starterId)
      }}
    >
      <div className="flex items-center gap-3 mb-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to templates"
          className="p-2 rounded-md-s hover:bg-muted text-muted-foreground cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-display text-foreground">New template</h1>
          <p className="text-muted-foreground text-sm">Name it and pick a starting point. You can change everything in the builder.</p>
        </div>
      </div>

      <div className="space-y-8">
        <label className="flex flex-col gap-1.5 text-sm max-w-md">
          <span className="font-medium text-foreground">Name</span>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Monthly newsletter"
            className="w-full bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <button
            type="button"
            onClick={() => setStarterId(undefined)}
            onDoubleClick={() => create(undefined)}
            className={optionClass(starterId === undefined)}
          >
            <div className="font-medium text-foreground">Blank</div>
            <div className="text-xs text-muted-foreground">An empty canvas.</div>
          </button>
        </div>

        {categories.map(category => (
          <div key={category} className="space-y-3">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{category}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {STARTER_TEMPLATES.filter(t => t.category === category).map(t => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setStarterId(t.id)}
                  onDoubleClick={() => create(t.id)}
                  className={optionClass(starterId === t.id)}
                >
                  <div className="font-medium text-foreground">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
        ))}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-6">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md-s border border-border hover:bg-muted cursor-pointer">
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="bg-primary text-primary-foreground px-5 py-2 rounded-md-s text-sm font-medium hover:bg-primary/85 disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? 'Creating…' : 'Create & open builder'}
          </button>
        </div>
      </div>
    </form>
  )
}

/** The template's name and description, edited together. */
function RenameTemplateDialog({
  template,
  onClose,
  onSave,
  isSaving,
  error,
}: {
  template: EmailTemplate
  onClose: () => void
  onSave: (name: string, description: string) => void
  isSaving: boolean
  error?: string
}) {
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  return (
    <Dialog isOpen onClose={onClose}  title="Edit template details" description="Shown on the template's card." className="sm:max-w-md">
      <form
        className="flex min-h-0 flex-col"
        onSubmit={e => {
          e.preventDefault()
          if (name.trim()) onSave(name.trim(), description.trim())
        }}
      >
        <DialogBody className="space-y-4">
          <Field label="Name">
            <input
              required
              maxLength={200}
              value={name}
              onChange={e => setName(e.target.value)}
              onFocus={e => e.currentTarget.select()}
              autoFocus
              className={INPUT_CLASS}
            />
          </Field>
          <Field label={<>Description <span className="font-normal text-muted-foreground">(optional)</span></>}>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={`${INPUT_CLASS} resize-none`} />
          </Field>
        </DialogBody>
        <DialogFooter>
          {error && <p className="text-[13px] text-destructive sm:mr-auto">{error}</p>}
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSaving}>
            Save changes
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
