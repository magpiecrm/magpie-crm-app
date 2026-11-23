import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BellOff, Building2, CheckCircle2, Copy, ExternalLink, Link2, Plus, RefreshCw } from 'lucide-react'
import { resubscribeContactFn, setContactCompanyFn } from '../../../../server/functions'
import { queryKeys } from '../../../../queryKeys'
import { Badge } from '../../../../components/ui/Badge'
import { Button } from '../../../../components/ui/Button'
import { toast } from '../../../../components/ui/toast'
import { CompanyPicker } from '../../../sales/components/CompanyPicker'
import { useInvalidateSales } from '../../../sales/usePipelines'
import { formatMoney, type CompanyView, type DealStatus, type DealView } from '../../../sales/types'
import { ContactCustomFields } from '../ContactCustomFields'
import type { ContactCustomValue, ContactFieldDef } from '../../contactFields'
import { formatDay } from '../../record'
import { DetailRow, PanelSection, SECTION_ACTION } from '../../../../components/ui/RecordSection'

export interface RecordContact {
  email: string
  status: string
  createdAt: string
  attributes: { FIRSTNAME: string; LASTNAME: string; JOB_TITLE: string; COMPANY: string }
  custom: Record<string, ContactCustomValue>
  linkedinUrl: string
  country: string
}

/** How a contact's email status reads: what it means, and its colour and icon. */
export function emailStatus(status: string) {
  if (status === 'subscribed') return { label: 'Subscribed', tone: 'good' as const, Icon: CheckCircle2, text: 'Campaigns and sequences can email them.' }
  if (status === 'bounced')
    return { label: 'Bounced', tone: 'bad' as const, Icon: AlertTriangle, text: 'Mail to this address bounced, so campaigns and sequences skip it. Only resubscribe if you know the address works again.' }
  return { label: 'Unsubscribed', tone: 'warn' as const, Icon: BellOff, text: 'They opted out, so campaigns and sequences skip them. Only resubscribe with their permission.' }
}

const TONE = {
  good: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-800 dark:text-amber-300',
  bad: 'text-destructive',
}

function Details({ contact, company }: { contact: RecordContact; company: CompanyView | null }) {
  const [showEmpty, setShowEmpty] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(contact.email)
      toast.success('Email address copied')
    } catch {
      toast.error("Couldn't copy the address")
    }
  }
  const companyName = company?.name || contact.attributes.COMPANY
  const rows: Array<{ label: string; value: React.ReactNode | null }> = [
    {
      label: 'Email',
      value: (
        <span className="flex min-w-0 items-start gap-1.5">
          <span className="min-w-0 break-words">
            {/* Breaks after the @ when it has to, not mid-word. */}
            {contact.email.split('@')[0]}@<wbr />
            {contact.email.split('@').slice(1).join('@')}
          </span>
          <button type="button" onClick={copy} aria-label="Copy email address" title="Copy" className="touch-target -my-0.5 shrink-0 rounded-md-xs p-0.5 text-muted-foreground hover:text-foreground cursor-pointer">
            <Copy className="h-3.5 w-3.5" />
          </button>
        </span>
      ),
    },
    { label: 'Job title', value: contact.attributes.JOB_TITLE || null },
    {
      label: 'Company',
      value: company ? (
        <Link to="/marketing/companies/$id" params={{ id: company.id }} className="text-accent hover:underline">
          {companyName}
        </Link>
      ) : (
        companyName || null
      ),
    },
    { label: 'Country', value: contact.country || null },
    {
      label: 'LinkedIn',
      value: contact.linkedinUrl ? (
        <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
          View profile
          <ExternalLink aria-hidden className="h-3 w-3" />
        </a>
      ) : null,
    },
    { label: 'Added', value: formatDay(contact.createdAt) },
  ]
  const empty = rows.filter((r) => !r.value).length
  return (
    <PanelSection title="Details">
      <dl>
        {rows
          .filter((r) => showEmpty || r.value)
          .map((r) => (
            <DetailRow key={r.label} label={r.label}>
              {r.value ?? <span className="text-muted-foreground">Not set</span>}
            </DetailRow>
          ))}
      </dl>
      {empty > 0 && (
        <button type="button" onClick={() => setShowEmpty((s) => !s)} className="mt-1 text-[13px] text-muted-foreground hover:text-foreground cursor-pointer">
          {showEmpty ? 'Hide empty fields' : `Show ${empty} empty field${empty === 1 ? '' : 's'}`}
        </button>
      )}
    </PanelSection>
  )
}

function EmailStatus({ contact, sent, opened, clicked }: { contact: RecordContact; sent: number; opened: number; clicked: number }) {
  const queryClient = useQueryClient()
  const s = emailStatus(contact.status)
  const resubscribe = useMutation({
    mutationFn: async () => {
      const res = await resubscribeContactFn({ data: { email: contact.email } })
      if (!res.success) throw new Error(res.error || "Couldn't resubscribe them")
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.contact(contact.email) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.contacts() })
    },
  })
  return (
    <PanelSection title="Email">
      <p className={`flex items-center gap-1.5 text-sm font-medium ${TONE[s.tone]}`}>
        <s.Icon aria-hidden className="h-4 w-4 shrink-0" />
        {s.label}
      </p>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{s.text}</p>
      {s.tone !== 'good' && (
        <div className="mt-3">
          <Button size="sm" variant="secondary" isLoading={resubscribe.isPending} onClick={() => resubscribe.mutate()} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
            Resubscribe
          </Button>
          {resubscribe.error && <p className="mt-2 text-[13px] text-destructive">{resubscribe.error.message}</p>}
        </div>
      )}
      <p className="mt-3 text-[13px] text-muted-foreground tabular-nums">
        {sent === 0 ? 'No campaigns sent to them yet.' : `${sent} campaign${sent === 1 ? '' : 's'} sent · ${opened} opened · ${clicked} clicked`}
      </p>
    </PanelSection>
  )
}

function CompanySection({ email, company }: { email: string; company: CompanyView | null }) {
  const queryClient = useQueryClient()
  const invalidateSales = useInvalidateSales()
  const [picking, setPicking] = useState(false)
  const link = useMutation({
    mutationFn: (companyId: string | null) => setContactCompanyFn({ data: { email, companyId } }),
    onSuccess: () => {
      setPicking(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.contact(email) })
      void invalidateSales()
    },
  })
  return (
    <PanelSection
      title="Company"
      action={
        !picking && (
          <button type="button" onClick={() => setPicking(true)} className={SECTION_ACTION}>
            {company ? 'Change' : (<><Link2 aria-hidden className="h-3 w-3" />Link</>)}
          </button>
        )
      }
    >
      {picking ? (
        <div className="space-y-2">
          <CompanyPicker value={null} onChange={(id) => link.mutate(id)} autoFocus />
          <div className="flex gap-2">
            {company && (
              <Button size="sm" variant="ghost" onClick={() => link.mutate(null)} isLoading={link.isPending && link.variables === null}>
                Unlink {company.name}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </div>
          {link.error && <p className="text-[13px] text-destructive">{link.error.message}</p>}
        </div>
      ) : company ? (
        <Link
          to="/marketing/companies/$id"
          params={{ id: company.id }}
          className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/60 transition-colors"
        >
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
            <Building2 className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{company.name}</span>
            <span className="block truncate text-[13px] text-muted-foreground">
              {[company.domain, company.contacts > 1 ? `${company.contacts} people` : null].filter(Boolean).join(' · ')}
            </span>
          </span>
        </Link>
      ) : (
        <p className="text-[13px] text-muted-foreground">Not linked to a company.</p>
      )}
    </PanelSection>
  )
}

const DEAL_STATUS: Record<DealStatus, { label: string; variant: 'info' | 'success' | 'error' }> = {
  open: { label: 'Open', variant: 'info' },
  won: { label: 'Won', variant: 'success' },
  lost: { label: 'Lost', variant: 'error' },
}

function DealsSection({ email, companyId, deals }: { email: string; companyId: string | null; deals: DealView[] }) {
  return (
    <PanelSection
      title="Deals"
      count={deals.length}
      action={
        <Link to="/sales/pipeline" search={{ new: 1, contact: email, ...(companyId ? { companyId } : {}) }} className={SECTION_ACTION}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          New deal
        </Link>
      }
    >
      {deals.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No deals with them yet.</p>
      ) : (
        <ul className="-mx-2">
          {deals.map((d) => (
            <li key={d.id}>
              <Link to="/sales/deals/$id" params={{ id: d.id }} className="flex items-start justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/60 transition-colors">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{d.name}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {d.stage_name}
                    {d.status === 'open' && d.expected_close ? ` · closes ${formatDay(`${d.expected_close}T12:00:00Z`)}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-medium text-foreground tabular-nums">{formatMoney(d.value, d.currency)}</span>
                  <Badge variant={DEAL_STATUS[d.status].variant}>{DEAL_STATUS[d.status].label}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  )
}

function ListsSection({ lists }: { lists: Array<{ id: number; name: string }> }) {
  return (
    <PanelSection title="Lists" count={lists.length}>
      {lists.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Not on any list.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {lists.map((l) => (
            <li key={l.id}>
              <Link
                to="/marketing/lists/$listId"
                params={{ listId: String(l.id) }}
                className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-[13px] text-foreground hover:border-accent hover:text-accent transition-colors"
              >
                {l.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  )
}

/** The side panel of a contact's page: who they are, whether email reaches them, and what they belong to. */
export function ContactSidebar({
  contact,
  fieldDefs,
  company,
  deals,
  lists,
  campaigns,
}: {
  contact: RecordContact
  fieldDefs: ContactFieldDef[]
  company: CompanyView | null
  deals: DealView[]
  lists: Array<{ id: number; name: string }>
  campaigns: Array<{ openedAt: string | null; clickedAt: string | null }>
}) {
  return (
    <aside aria-label="About this contact" className="rounded-xl border border-border bg-card">
      <Details contact={contact} company={company} />
      <ContactCustomFields email={contact.email} defs={fieldDefs} custom={contact.custom ?? {}} />
      <EmailStatus
        contact={contact}
        sent={campaigns.length}
        opened={campaigns.filter((c) => c.openedAt).length}
        clicked={campaigns.filter((c) => c.clickedAt).length}
      />
      <CompanySection email={contact.email} company={company} />
      <DealsSection email={contact.email} companyId={company?.id ?? null} deals={deals} />
      <ListsSection lists={lists} />
    </aside>
  )
}
