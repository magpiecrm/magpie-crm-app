import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getTemplatesFn } from '../../../server/functions'
import { STARTER_TEMPLATES } from '../../email-builder/templates/starters'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { INPUT_CLASS } from '../../../components/ui/Field'
import { starterHtml } from '../preview'
import { TemplatePreviewDialog, TemplateTile } from './TemplateTile'

interface Choice {
  key: string
  name: string
  description: string
  html: string
}

/** A tab of a segmented control: one row of pill buttons, the current one raised. */
export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
  label,
  className = '',
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: React.ReactNode }>
  label: string
  className?: string
}) {
  return (
    <div role="tablist" aria-label={label} className={`inline-flex max-w-full gap-1 overflow-x-auto rounded-md-s bg-muted p-1 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 cursor-pointer whitespace-nowrap rounded-md-xs px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
            value === o.value ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.08)] dark:bg-white/10' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Pick a design to start an email from: the team's saved templates or the
 * starter layouts, as pictures, with a search and a full preview. `onPick`
 * gets the chosen email's HTML; the caller confirms before replacing a design.
 */
export function TemplateLibraryDialog({ onClose, onPick }: { onClose: () => void; onPick: (html: string, name: string) => void }) {
  const { data: saved = [], isLoading } = useQuery({ queryKey: queryKeys.templates.list(), queryFn: () => getTemplatesFn() })
  const [tab, setTab] = useState<'saved' | 'starters' | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<Choice | null>(null)
  // Open on the team's own templates when there are any.
  const current = tab ?? (isLoading || saved.length > 0 ? 'saved' : 'starters')

  const choices = useMemo<Choice[]>(() => {
    const all =
      current === 'saved'
        ? saved.map((t) => ({ key: `saved:${t.id}`, name: t.name, description: t.description, html: t.html }))
        : STARTER_TEMPLATES.map((t) => ({ key: `starter:${t.id}`, name: t.name, description: t.description, html: starterHtml(t) }))
    const q = query.trim().toLowerCase()
    return q ? all.filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(q)) : all
  }, [current, saved, query])

  const chosen = choices.find((c) => c.key === selected) ?? null
  const use = (c: Choice) => {
    onPick(c.html, c.name)
    onClose()
  }

  return (
    <>
      <Dialog isOpen onClose={onClose} title="Choose a template" description="It replaces the email's current design. You can change everything after." className="sm:max-w-4xl">
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3 sm:px-6">
          <SegmentedTabs
            label="Templates to show"
            value={current}
            onChange={(v) => {
              setTab(v)
              setSelected(null)
            }}
            options={[
              { value: 'saved', label: <>Your templates <span className="tabular-nums text-muted-foreground">{saved.length}</span></> },
              { value: 'starters', label: <>Starters <span className="tabular-nums text-muted-foreground">{STARTER_TEMPLATES.length}</span></> },
            ]}
          />
          <label className="relative ml-auto w-full sm:w-60">
            <span className="sr-only">Search templates</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className={`${INPUT_CLASS} pl-9`} />
          </label>
        </div>
        <DialogBody className="pt-1">
          {current === 'saved' && !isLoading && saved.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No saved templates yet. Save a design from the builder, or{' '}
              <button type="button" onClick={() => setTab('starters')} className="cursor-pointer font-medium text-accent underline-offset-2 hover:underline">
                start from a layout
              </button>
              .
            </p>
          ) : choices.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Nothing matches “{query.trim()}”.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {choices.map((c) => (
                <TemplateTile
                  key={c.key}
                  html={c.html}
                  name={c.name}
                  description={c.description}
                  selected={selected === c.key}
                  onSelect={() => setSelected(c.key)}
                  onActivate={() => use(c)}
                  onPreview={() => setPreviewing(c)}
                />
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!chosen} onClick={() => chosen && use(chosen)}>
            Use template
          </Button>
        </DialogFooter>
      </Dialog>
      {previewing && (
        <TemplatePreviewDialog
          html={previewing.html}
          name={previewing.name}
          description={previewing.description}
          onClose={() => setPreviewing(null)}
          actionLabel="Use template"
          onAction={() => {
            setPreviewing(null)
            use(previewing)
          }}
        />
      )}
    </>
  )
}
