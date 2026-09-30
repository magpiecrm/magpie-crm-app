import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, FilePlus2, Pencil, Send, Trash2 } from 'lucide-react'
import { createProposalFn, deleteProposalFn, getTemplatesFn, proposalsFn, sendProposalFn, shareProposalFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { queryKeys } from '../../../queryKeys'
import { FIELD_CLASS } from '../forms'
import { formatDay } from '../utils'
import { useRefreshSales } from './useSalesLookups'
import type { DealView, ProposalSummary } from '../types'
import { Select } from '../../../components/ui/Select'

const PANEL = 'bg-card border border-border rounded-xl p-5'

/** "today 14:05", or a date. */
function seen(iso: string): string {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString()
    ? `today ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : formatDay(iso)
}

function status(p: ProposalSummary): { text: string; tone: 'good' | 'live' | 'muted' } {
  if (p.accepted_at) return { text: `Accepted by ${p.accepted_by} · ${seen(p.accepted_at)}`, tone: 'good' }
  if (p.views > 0 && p.last_viewed_at) return { text: `Opened ${p.views === 1 ? 'once' : `${p.views} times`} · last ${seen(p.last_viewed_at)}`, tone: 'live' }
  if (p.sent_at) return { text: `Sent ${seen(p.sent_at)} · not opened yet`, tone: 'muted' }
  return { text: 'Draft', tone: 'muted' }
}

const TONE = { good: 'text-emerald-600 dark:text-emerald-400', live: 'text-accent', muted: 'text-muted-foreground' }

/** A deal's proposals: make one, edit it, and share its link or email it. */
export function ProposalsPanel({ deal }: { deal: DealView }) {
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState<ProposalSummary | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const refresh = useRefreshSales()
  const queryClient = useQueryClient()
  const { data = [] } = useQuery({
    queryKey: queryKeys.sales.proposals(deal.id),
    queryFn: () => proposalsFn({ data: { dealId: deal.id } }),
    // Picks up opens while the page is open.
    refetchInterval: 60_000,
  })
  const changed = (note?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sales.proposals(deal.id) })
    refresh(deal.id)
    setMessage(note ?? null)
  }
  const moved = (to: string | null) => (to ? ` The deal moved to ${to}.` : '')

  const share = useMutation({
    // The copy starts in the click itself, which browsers require.
    mutationFn: async ({ p, copied }: { p: ProposalSummary; copied: Promise<boolean> }) => {
      const res = await shareProposalFn({ data: { id: p.id } })
      return { ...res, ok: await copied }
    },
    onSuccess: (res) => changed(`${res.ok ? 'Link copied.' : `Couldn't copy it: the link is ${res.url}`}${moved(res.movedTo)}`),
    onError: (err) => setMessage((err as Error).message),
  })
  const remove = useMutation({
    mutationFn: (p: ProposalSummary) => deleteProposalFn({ data: { id: p.id } }),
    onSuccess: () => changed('Deleted. Its link no longer works.'),
  })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  return (
    <section className={PANEL}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-foreground">Proposals</h2>
        <Button size="sm" variant="ghost" leftIcon={<FilePlus2 className="w-3.5 h-3.5" />} onClick={() => setCreating(true)}>
          New
        </Button>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Design a proposal, send it as a link, and see when they open it. They can accept it on the page.
        </p>
      ) : (
        <ul className="space-y-4">
          {data.map((p) => {
            const s = status(p)
            return (
              <li key={p.id} className="space-y-1.5">
                <Link to="/sales/proposals/$proposalId" params={{ proposalId: p.id }} className="block text-sm font-medium text-foreground hover:text-accent break-words">
                  {p.title}
                </Link>
                <p className={`text-xs tabular-nums ${TONE[s.tone]}`} title={p.bot_views ? `Also opened ${p.bot_views} times by link scanners, which aren't counted.` : undefined}>
                  {s.tone === 'good' && <Check className="inline w-3 h-3 mr-1 -mt-0.5" />}
                  {s.text}
                </p>
                <div className="flex flex-wrap items-center gap-1 -ml-2">
                  <Button size="sm" variant="ghost" leftIcon={<Send className="w-3.5 h-3.5" />} onClick={() => setSending(p)}>
                    Email
                  </Button>
                  <Button size="sm" variant="ghost" leftIcon={<Copy className="w-3.5 h-3.5" />} isLoading={share.isPending && share.variables?.p.id === p.id}
                    onClick={() =>
                      share.mutate({ p, copied: (navigator.clipboard?.writeText(p.url) ?? Promise.reject()).then(() => true, () => false) })
                    }
                  >
                    Copy link
                  </Button>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Preview
                  </a>
                  <Link
                    to="/sales/proposals/$proposalId"
                    params={{ proposalId: p.id }}
                    aria-label={`Edit ${p.title}`}
                    className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Link>
                  {confirmDelete === p.id ? (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <Button size="sm" variant="danger" isLoading={remove.isPending} onClick={() => remove.mutate(p)}>
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(p.id)}
                      aria-label={`Delete ${p.title}`}
                      className="p-1.5 text-muted-foreground hover:text-destructive rounded-md hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {message && (
        <p role="status" className="mt-3 text-xs text-muted-foreground break-words">
          {message}
        </p>
      )}
      {creating && <NewProposalDialog deal={deal} onClose={() => setCreating(false)} />}
      {sending && (
        <SendProposalDialog
          deal={deal}
          proposal={sending}
          onClose={() => setSending(null)}
          onSent={(note) => {
            setSending(null)
            changed(note)
          }}
        />
      )}
    </section>
  )
}

function NewProposalDialog({ deal, onClose }: { deal: DealView; onClose: () => void }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(`Proposal for ${deal.company_name ?? deal.name}`)
  const [start, setStart] = useState<'layout' | 'template' | 'blank'>('layout')
  const [templateId, setTemplateId] = useState('')
  const { data: templates = [] } = useQuery({ queryKey: queryKeys.templates.list(), queryFn: () => getTemplatesFn() })
  const create = useMutation({
    mutationFn: () => createProposalFn({ data: { dealId: deal.id, title, start, templateId: start === 'template' ? templateId : undefined } }),
    onSuccess: (p) => navigate({ to: '/sales/proposals/$proposalId', params: { proposalId: p.id } }),
  })
  const ready = title.trim() && (start !== 'template' || templateId)
  const option = (value: typeof start, label: string, hint: string, disabled = false) => (
    <label className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${start === value ? 'border-accent bg-accent/5' : 'border-border'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <input type="radio" name="start" value={value} checked={start === value} disabled={disabled} onChange={() => setStart(value)} className="mt-1 accent-accent" />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
  return (
    <Dialog isOpen onClose={onClose} title="New proposal">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) create.mutate()
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="proposal-title" className="block text-sm font-medium text-foreground mb-1">
            Title
          </label>
          <input id="proposal-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={FIELD_CLASS} />
          <p className="mt-1 text-xs text-muted-foreground">They'll see it at the top of the page and in the email.</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground mb-1">Start from</legend>
          {option('layout', 'Proposal layout', 'Summary, scope, price and next steps, filled in from this deal.')}
          {option('template', 'A saved template', templates.length ? 'One of your email templates.' : "You haven't saved any templates yet.", !templates.length)}
          {start === 'template' && (
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Template" className={FIELD_CLASS}>
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          {option('blank', 'Blank', 'An empty page.')}
        </fieldset>
        <div className="flex items-center justify-end gap-2">
          <span className="flex-1 text-xs text-destructive">{(create.error as Error | null)?.message}</span>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={create.isPending} disabled={!ready}>
            Create and edit
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function SendProposalDialog({
  deal,
  proposal,
  onClose,
  onSent,
}: {
  deal: DealView
  proposal: ProposalSummary
  onClose: () => void
  onSent: (note: string) => void
}) {
  const [to, setTo] = useState<string[]>(deal.contacts.slice(0, 1).map((c) => c.email))
  const [subject, setSubject] = useState(proposal.title)
  const firstName = deal.contacts[0]?.name?.split(' ')[0]
  const [message, setMessage] = useState(
    `${firstName ? `Hi ${firstName},` : 'Hi,'}\n\nAs promised, here's our proposal for ${deal.company_name ?? deal.name}. It sets out what we'll do and what it costs, and you can accept it on the page when you're ready.\n\nAny questions, just reply to this email.`,
  )
  const send = useMutation({
    mutationFn: async () => {
      const res = await sendProposalFn({ data: { id: proposal.id, to, subject, message } })
      const skipped = res.skipped.map((s) => `${s.email} (${s.why})`).join(', ')
      if (!res.sent.length) throw new Error(`Not sent: ${skipped}.`)
      return `Sent to ${res.sent.join(', ')}.${skipped ? ` Not to ${skipped}.` : ''}${res.movedTo ? ` The deal moved to ${res.movedTo}.` : ''}`
    },
    onSuccess: onSent,
  })
  const toggle = (email: string) => setTo((cur) => (cur.includes(email) ? cur.filter((e) => e !== email) : [...cur, email]))
  return (
    <Dialog isOpen onClose={onClose} title={`Email “${proposal.title}”`}>
      {deal.contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add someone to this deal (People) to email it, or copy its link and send it yourself.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (to.length) send.mutate()
          }}
          className="space-y-4"
        >
          <fieldset>
            <legend className="text-sm font-medium text-foreground mb-1">To</legend>
            <div className="space-y-1">
              {deal.contacts.map((c) => (
                <label key={c.email} className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={to.includes(c.email)} onChange={() => toggle(c.email)} className="accent-accent" />
                  {c.name ? `${c.name} · ` : ''}
                  <span className="text-muted-foreground">{c.email}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="proposal-subject" className="block text-sm font-medium text-foreground mb-1">
              Subject
            </label>
            <input id="proposal-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} className={FIELD_CLASS} />
          </div>
          <div>
            <label htmlFor="proposal-message" className="block text-sm font-medium text-foreground mb-1">
              Message
            </label>
            <textarea id="proposal-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={7} className={`${FIELD_CLASS} resize-y`} />
            <p className="mt-1 text-xs text-muted-foreground">A button to open the proposal goes below your message. It's sent from your default sender.</p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="flex-1 text-xs text-destructive">{(send.error as Error | null)?.message}</span>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" leftIcon={<Send className="w-4 h-4" />} isLoading={send.isPending} disabled={!to.length || !subject.trim()}>
              Send
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
