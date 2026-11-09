import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ArrowLeft, Copy, LayoutTemplate, Pencil, Plus, Search, Send, TextCursorInput, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import {
  createTemplateFn,
  deleteTemplateFn,
  duplicateTemplateFn,
  getTemplatesFn,
  updateTemplateFn,
} from '../../../server/functions'
import { STARTER_CATEGORIES, STARTER_TEMPLATES, type StarterCategory, type StarterTemplate } from '../../../features/email-builder/templates/starters'
import { TemplateThumbnail } from '../../../features/templates/components/TemplateThumbnail'
import { TemplatePreviewDialog, TemplateTile } from '../../../features/templates/components/TemplateTile'
import { SegmentedTabs } from '../../../features/templates/components/TemplateLibraryDialog'
import { starterHtml } from '../../../features/templates/preview'
import type { EmailTemplate } from '../../../features/templates/types'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { ActionMenu } from '../../../components/ui/Menu'
import { Select } from '../../../components/ui/Select'
import { confirmDialog } from '../../../components/ui/confirm'
import { toast } from '../../../components/ui/toast'

export const Route = createFileRoute('/marketing/templates/')({
  component: TemplatesPage,
})

/** Every gallery of templates on this page: the same columns, so a template is the same size wherever it shows. */
const GRID = 'grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'

/** A gallery tile's picture: wide on a phone, where one fills the row, upright elsewhere. */
const TILE_SHAPE = 'aspect-[4/3] sm:aspect-[4/5]'

/** The starters the empty page offers, one from each kind most teams send. */
const FIRST_STARTERS = ['plain-email', 'newsletter-editorial', 'product-update', 'event-invite']

const editedOn = (iso: string) => {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

function TemplatesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Undefined while the list shows; otherwise New template, with a starter already picked or none (blank).
  const [creating, setCreating] = useState<{ starterId?: string } | undefined>(undefined)
  const [renaming, setRenaming] = useState<EmailTemplate | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'edited' | 'name'>('edited')

  const { data: templates = [], isLoading } = useQuery({
    queryKey: queryKeys.templates.list(),
    queryFn: () => getTemplatesFn(),
  })

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? templates.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(q)) : templates
    return sort === 'name' ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list
  }, [templates, query, sort])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.templates.list() })

  const openBuilder = (id: string) =>
    navigate({ to: '/marketing/templates/$templateId/edit', params: { templateId: id } })
  const startCampaign = (id: string) => navigate({ to: '/marketing/campaigns', search: { template: id } })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; starterId?: string }) => createTemplateFn({ data }),
    onSuccess: template => {
      invalidate()
      setCreating(undefined)
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
  if (creating) {
    return (
      <CreateTemplateView
        initialStarterId={creating.starterId}
        onClose={() => setCreating(undefined)}
        onCreate={data => createMutation.mutate(data)}
        isSaving={createMutation.isPending}
        error={createMutation.error?.message}
      />
    )
  }

  return (
    <div className="mx-auto max-w-[1400px] p-4 lg:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-display text-foreground">Templates</h1>
          <p className="mt-1 text-muted-foreground max-sm:text-[15px]">Reusable email designs to start campaigns from.</p>
        </div>
        {/* The empty page has its own way in. */}
        {(isLoading || templates.length > 0) && (
          <Button onClick={() => setCreating({})} leftIcon={<Plus className="h-4 w-4" />} className="shrink-0">
            New template
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className={GRID}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-[4/3] rounded-md-m bg-muted sm:aspect-[4/5]" />
              <div className="mt-3 h-4 w-2/3 rounded bg-muted" />
              <div className="mt-2 h-3 w-1/3 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <EmptyTemplates onStart={starterId => setCreating({ starterId })} />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <label className="relative w-full sm:w-72">
              <span className="sr-only">Search templates</span>
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search templates" className={`${INPUT_CLASS} pl-9`} />
            </label>
            <p className="text-[13px] text-muted-foreground tabular-nums max-sm:order-last max-sm:w-full">
              {query.trim() ? `${shown.length} of ${templates.length}` : `${templates.length} ${templates.length === 1 ? 'template' : 'templates'}`}
            </p>
            <div className="w-44 sm:ml-auto max-sm:flex-1">
              <Select value={sort} onChange={e => setSort(e.target.value as 'edited' | 'name')} aria-label="Sort templates" className={INPUT_CLASS}>
                <option value="edited">Last edited</option>
                <option value="name">Name</option>
              </Select>
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No templates match “{query.trim()}”.</p>
          ) : (
            <div className={GRID}>
              {shown.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onOpen={() => openBuilder(template.id)}
                  onUse={() => startCampaign(template.id)}
                  onRename={() => rename(template)}
                  onDuplicate={() => duplicateMutation.mutate(template.id)}
                  onDelete={() => confirmDelete(template)}
                />
              ))}
            </div>
          )}
        </>
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

/**
 * A saved template: its picture and name open the builder, Use in campaign
 * shows over the picture (on pointing or focus, always on a touch screen),
 * and the "…" menu beside the name has the rest.
 */
function TemplateCard({
  template,
  onOpen,
  onUse,
  onRename,
  onDuplicate,
  onDelete,
}: {
  template: EmailTemplate
  onOpen: () => void
  onUse: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <article data-template-card className="group flex min-w-0 flex-col">
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Edit ${template.name}`}
          className="block w-full cursor-pointer overflow-hidden rounded-md-m border border-border transition-[border-color,box-shadow] hover:border-foreground/25 hover:shadow-[0_4px_16px_-6px_rgb(17_19_22/0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-white/10"
        >
          {/* Wide on a phone, where one card fills the row; the gallery's shape everywhere else. */}
          <TemplateThumbnail html={template.html} className="aspect-[4/3] sm:aspect-[4/5]" />
        </button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
          <Button size="sm" onClick={onUse} className="pointer-events-auto shadow-md max-sm:min-h-9">
            Use in campaign
          </Button>
        </div>
      </div>
      <div className="mt-3 flex items-start gap-1">
        <button type="button" onClick={onOpen} tabIndex={-1} className="min-w-0 flex-1 cursor-pointer text-left">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground" title={template.name}>
            {template.name}
          </h3>
        </button>
        <ActionMenu
          label={`Actions for ${template.name}`}
          className="-mr-1.5 -mt-1"
          actions={[
            { label: 'Edit design', icon: Pencil, onSelect: onOpen },
            { label: 'Use in campaign', icon: Send, onSelect: onUse },
            { label: 'Edit details', icon: TextCursorInput, onSelect: onRename },
            { label: 'Duplicate', icon: Copy, onSelect: onDuplicate },
            { label: 'Delete', icon: Trash2, onSelect: onDelete, danger: true, separated: true },
          ]}
        />
      </div>
      {/* Two lines kept for the description, so cards along a row line up. */}
      <p className="mt-0.5 line-clamp-2 min-h-[2.3rem] text-[13px] leading-snug text-muted-foreground" title={template.description || undefined}>
        {template.description}
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground/90">Edited {editedOn(template.updated_at)}</p>
    </article>
  )
}

/** No templates yet: say what they're for and offer a few layouts to start from. */
function EmptyTemplates({ onStart }: { onStart: (starterId?: string) => void }) {
  const [previewing, setPreviewing] = useState<StarterTemplate | null>(null)
  const starters = FIRST_STARTERS.map(id => STARTER_TEMPLATES.find(t => t.id === id)!).filter(Boolean)
  return (
    <div className="mx-auto max-w-5xl rounded-md-xl border border-border bg-card px-5 py-10 sm:px-10">
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-accent/10 text-accent">
          <LayoutTemplate aria-hidden className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-medium text-foreground">No templates yet</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Keep the designs you send often, and start each campaign from one. Begin with a starter, or save any campaign's design from the builder.
        </p>
      </div>
      <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-x-4 gap-y-7 sm:gap-x-5 md:grid-cols-4">
        {starters.map(t => (
          <TemplateTile
            key={t.id}
            html={starterHtml(t)}
            name={t.name}
            description={t.description}
            onSelect={() => onStart(t.id)}
            onPreview={() => setPreviewing(t)}
          />
        ))}
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => onStart(STARTER_TEMPLATES[0].id)} leftIcon={<LayoutTemplate className="h-4 w-4" />}>
          Browse all {STARTER_TEMPLATES.length} starters
        </Button>
        <Button variant="secondary" onClick={() => onStart(undefined)} leftIcon={<Plus className="h-4 w-4" />}>
          Start from scratch
        </Button>
      </div>
      {previewing && (
        <TemplatePreviewDialog
          html={starterHtml(previewing)}
          name={previewing.name}
          description={previewing.description}
          onClose={() => setPreviewing(null)}
          actionLabel="Use template"
          onAction={() => onStart(previewing.id)}
        />
      )}
    </div>
  )
}

function CreateTemplateView({
  initialStarterId,
  onClose,
  onCreate,
  isSaving,
  error,
}: {
  initialStarterId?: string
  onClose: () => void
  onCreate: (data: { name: string; starterId?: string }) => void
  isSaving: boolean
  error?: string
}) {
  const [name, setName] = useState('')
  const [starterId, setStarterId] = useState<string | undefined>(initialStarterId)
  const [category, setCategory] = useState<StarterCategory | 'all'>('all')
  const [previewing, setPreviewing] = useState<StarterTemplate | null>(null)
  const starter = STARTER_TEMPLATES.find(t => t.id === starterId)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = STARTER_TEMPLATES.filter(t => (category === 'all' || t.category === category) && (!q || `${t.name} ${t.description}`.toLowerCase().includes(q)))

  const create = (id: string | undefined) => {
    const picked = STARTER_TEMPLATES.find(t => t.id === id)
    onCreate({ name: name.trim() || picked?.name || 'Untitled template', starterId: id })
  }

  return (
    <form
      className="flex min-h-full flex-col"
      onSubmit={e => {
        e.preventDefault()
        create(starterId)
      }}
    >
      <div className="mx-auto w-full max-w-[1400px] flex-1 p-4 lg:p-8">
        <div className="mb-6 flex items-start gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to templates"
            className="-ml-2 mt-0.5 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md-s text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-display text-foreground">New template</h1>
            <p className="mt-1 text-muted-foreground max-sm:text-[15px]">Pick a starter to begin from. You can change everything in the builder.</p>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <SegmentedTabs
            scroll
            label="Kinds of starter"
            value={category}
            onChange={setCategory}
            options={[{ value: 'all' as const, label: 'All' }, ...STARTER_CATEGORIES.map(c => ({ value: c, label: c }))]}
          />
          <label className="relative w-full sm:ml-auto sm:w-60">
            <span className="sr-only">Search starters</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" className={`${INPUT_CLASS} pl-9`} />
          </label>
        </div>

        {shown.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">No starters match “{query.trim()}”.</p>}
        <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {category === 'all' && !query.trim() && (
            <TemplateTile
              blank
              shape={TILE_SHAPE}
              name="Blank"
              description="An empty canvas: start from scratch."
              selected={starterId === undefined}
              onSelect={() => setStarterId(undefined)}
              onActivate={() => create(undefined)}
            />
          )}
          {shown.map(t => (
            <TemplateTile
              key={t.id}
              shape={TILE_SHAPE}
              html={starterHtml(t)}
              name={t.name}
              description={t.description}
              selected={starterId === t.id}
              onSelect={() => setStarterId(t.id)}
              onActivate={() => create(t.id)}
              onPreview={() => setPreviewing(t)}
            />
          ))}
        </div>
      </div>

      {/* Stays at the bottom of the screen, so the name and Create are always in reach. */}
      <div className="sticky bottom-0 z-10 border-t border-border bg-card shadow-[0_-6px_16px_-10px_rgb(17_19_22/0.18)] dark:shadow-none">
        <div className="mx-auto flex w-full max-w-[1400px] items-end gap-3 px-4 py-3 lg:px-8">
          <Field label={<>Template name <span className="font-normal text-muted-foreground">(optional)</span></>} className="min-w-0 flex-1 sm:w-80 sm:flex-none">
            <input value={name} onChange={e => setName(e.target.value)} placeholder={starter?.name ?? 'Untitled template'} maxLength={200} className={INPUT_CLASS} />
          </Field>
          {error && <p className="text-[13px] text-destructive max-sm:hidden sm:self-center">{error}</p>}
          <div className="flex shrink-0 gap-2 sm:ml-auto">
            {/* On a phone the back arrow cancels, so the bar stays one row. */}
            <Button type="button" variant="secondary" onClick={onClose} className="max-sm:hidden">
              Cancel
            </Button>
            <Button type="submit" isLoading={isSaving}>
              Create template
            </Button>
          </div>
        </div>
      </div>
      {previewing && (
        <TemplatePreviewDialog
          html={starterHtml(previewing)}
          name={previewing.name}
          description={previewing.description}
          onClose={() => setPreviewing(null)}
          actionLabel="Use template"
          onAction={() => {
            setPreviewing(null)
            create(previewing.id)
          }}
        />
      )}
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
    <Dialog isOpen onClose={onClose} title="Edit details" className="sm:max-w-lg">
      <form
        className="flex min-h-0 flex-col"
        onSubmit={e => {
          e.preventDefault()
          if (name.trim()) onSave(name.trim(), description.trim())
        }}
      >
        <DialogBody>
          <div className="flex gap-4">
            <TemplateThumbnail html={template.html} inset={6} className="aspect-[4/5] w-24 shrink-0 rounded-md-s border border-border max-sm:hidden dark:border-white/10" />
            <div className="min-w-0 flex-1 space-y-4">
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
              <Field label={<>Description <span className="font-normal text-muted-foreground">(optional)</span></>} hint="Shown on the template's card.">
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={`${INPUT_CLASS} resize-none`} />
              </Field>
            </div>
          </div>
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
