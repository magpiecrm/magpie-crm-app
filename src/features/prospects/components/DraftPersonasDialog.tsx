import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Sparkles } from 'lucide-react'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { createPersonaFn, draftPersonasFn } from '../../../server/functions'
import { SENIORITY_LABEL } from '../../../server/prospecting/types'
import type { PersonaDraft } from '../../../server/prospecting/personaDraft'
import type { AiAvailability } from '../../../server/copilot/availability'

// The AI reads the workspace's website and suggests personas
// (server/prospecting/personaDraft.ts). Nothing is kept until one is added.

/** A draft's filters, as chips: what applying it would search for. */
function CriteriaChips({ draft }: { draft: PersonaDraft }) {
  const c = draft.criteria
  const chips = [
    ...c.titles.map((t) => ({ text: t, variant: 'default' as const })),
    ...c.seniorities.map((s) => ({ text: SENIORITY_LABEL[s], variant: 'default' as const })),
    ...c.industries.map((i) => ({ text: i, variant: 'info' as const })),
    ...c.companySizes.map((b) => ({ text: `${b} staff`, variant: 'info' as const })),
    ...(c.country ? [{ text: c.country, variant: 'info' as const }] : []),
    ...(c.keyword ? [{ text: `"${c.keyword}"`, variant: 'info' as const }] : []),
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip, i) => (
        <Badge key={i} variant={chip.variant}>
          {chip.text}
        </Badge>
      ))}
    </div>
  )
}

export function DraftPersonasDialog({ isOpen, onClose, websiteUrl, ai }: { isOpen: boolean; onClose: () => void; websiteUrl: string; ai: AiAvailability }) {
  const queryClient = useQueryClient()
  const [website, setWebsite] = useState(websiteUrl)
  const [note, setNote] = useState('')
  // Which drafts have been added, by their place in the list.
  const [added, setAdded] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (isOpen) setWebsite((w) => w || websiteUrl)
  }, [isOpen, websiteUrl])

  const draft = useMutation({
    mutationFn: () => draftPersonasFn({ data: { websiteUrl: website, note: note.trim() || undefined } }),
    onSuccess: () => setAdded(new Set()),
  })
  const add = useMutation({
    mutationFn: async (which: number[]) => {
      for (const i of which) {
        await createPersonaFn({ data: draft.data![i] })
        setAdded((s) => new Set(s).add(i))
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.prospects.personas() }),
  })

  const drafts = draft.data ?? []
  const left = drafts.map((_, i) => i).filter((i) => !added.has(i))
  const close = () => {
    if (draft.isPending) return
    draft.reset()
    add.reset()
    setAdded(new Set())
    onClose()
  }

  // Reading the website takes Claude's web tools.
  const blocked = !ai.ok ? ai.reason : !ai.web ? "It reads your website with Claude's web tools, so it needs an Anthropic key: add one in Settings → Copilot." : null
  if (blocked) {
    return (
      <Dialog isOpen={isOpen} onClose={close} title="Draft personas with AI">
        <div className="p-4 sm:p-6 space-y-4">
          <Notice>{blocked}</Notice>
          <div className="flex justify-end">
            <Button variant="outline" onClick={close}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog isOpen={isOpen} onClose={close} title="Draft personas with AI" className="max-w-2xl">
      <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
        <p className="text-sm text-muted-foreground">
          The AI reads your website and suggests who to prospect: job titles, the companies they work at, and what they care about. Only your website and
          what you add below go to it. Nothing is saved until you add a persona.
        </p>
        <Field label="Your website">
          <input className={INPUT_CLASS} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" disabled={draft.isPending} />
        </Field>
        <Field label="Anything it should know" hint="Optional. For example who your best customers are, or a market you don't sell to.">
          <textarea
            className={`${INPUT_CLASS} resize-y font-[inherit]`}
            rows={2}
            maxLength={1_000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={draft.isPending}
            placeholder="We sell mostly to UK firms with a few hundred staff."
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button onClick={() => draft.mutate()} isLoading={draft.isPending} disabled={!website.trim()} leftIcon={<Sparkles className="w-4 h-4" />}>
            {drafts.length ? 'Draft again' : 'Draft personas'}
          </Button>
          {draft.isPending && <span className="text-xs text-muted-foreground">Reading your website. This takes a minute or so.</span>}
        </div>
        {draft.isError && <Notice level="error">{(draft.error as Error).message}</Notice>}

        {drafts.length > 0 && !draft.isPending && (
          <div className="space-y-3 pt-2 border-t border-border">
            {drafts.map((d, i) => (
              <div key={i} className="card border border-border rounded-md-m p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">{d.name}</h3>
                    {d.description && <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>}
                  </div>
                  {added.has(i) ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                      <Check className="w-3.5 h-3.5" /> Added
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => add.mutate([i])} disabled={add.isPending} leftIcon={<Plus className="w-3.5 h-3.5" />}>
                      Add
                    </Button>
                  )}
                </div>
                <CriteriaChips draft={d} />
                {d.painPoints && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Pain points: </span>
                    {d.painPoints}
                  </p>
                )}
                {d.valueProp && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Why they'd care: </span>
                    {d.valueProp}
                  </p>
                )}
              </div>
            ))}
            {add.isError && <Notice level="error">{(add.error as Error).message}</Notice>}
            <div className="flex justify-end gap-2">
              {left.length > 1 && (
                <Button variant="outline" onClick={() => add.mutate(left)} isLoading={add.isPending}>
                  Add all {left.length}
                </Button>
              )}
              <Button variant={left.length ? 'ghost' : 'primary'} onClick={close}>
                {left.length ? 'Close' : 'Done'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
