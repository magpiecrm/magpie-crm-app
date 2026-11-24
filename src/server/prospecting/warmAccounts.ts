// Warm accounts: companies where the workspace's own email, forms or
// proposals found interest in the last 90 days, for the "Warm" signal on
// prospect search results (signals.ts) and the Warm filter, which searches
// inside those companies first.
//
// Counted per company, from what the workspace already holds: replies,
// clicks and opens by people (scanners left out, clickFilter.ts), form and
// survey answers, and proposal views and acceptances. A company is warm on
// any reply, click, form, survey or proposal event, or opens from two people
// or more. A complaint or unsubscribe there in the same 90 days cancels it.
// Only counts leave this file, never who.

import type { DbSchema } from '../db'
import { workDomain } from '../sales/companies'
import type { Signal } from './types'

const DAYS = 90
const DAY = 86_400_000
/** How long an index is reused: it's rebuilt from the whole database, and searches ask for it per batch. */
const FRESH_MS = 60_000
const MAX_COMPANIES = 10_000

export interface WarmSummary {
  key: string
  /** The CRM company, where the contacts there are linked to one. */
  companyId: string | null
  domain: string | null
  /** Numeric LinkedIn company id, where known: what the Warm filter searches inside. */
  ref: string | null
  /** LinkedIn company page name, where known: the host's verified search goes inside a company by it, or by name. */
  slug: string | null
  name: string | null
  replies: number
  clicks: number
  /** People who opened (scanners left out). */
  openers: number
  forms: number
  proposalViews: number
  accepted: number
  /** The latest of it (ISO). */
  lastAt: string
}

export interface WarmIndex {
  /** Every warm company, most recent first. */
  all: WarmSummary[]
  byDomain: Map<string, WarmSummary>
  byRef: Map<string, WarmSummary>
  /** One person's own: for a search result who is already a contact. */
  byEmail: Map<string, WarmSummary>
}

type Data = Pick<DbSchema, 'contacts' | 'campaign_recipients' | 'form_submissions' | 'survey_responses' | 'companies' | 'deals' | 'proposals' | 'sequence_enrollments' | 'prospect_companies'>

let memo: { at: number; index: WarmIndex } | null = null

/** Forgets the index (tests, or straight after the engagement it's built from changes). */
export function forgetWarmIndex() {
  memo = null
}

interface Tally {
  companyId: string | null
  domain: string | null
  replies: number
  clicks: number
  openers: Set<string>
  forms: number
  proposalViews: number
  accepted: number
  lastAt: string
  cancelled: boolean
}

const blank = (): Tally => ({ companyId: null, domain: null, replies: 0, clicks: 0, openers: new Set(), forms: 0, proposalViews: 0, accepted: 0, lastAt: '', cancelled: false })
const later = (a: string, b: string | null | undefined) => (b && b > a ? b : a)

/** The workspace's warm companies, from the last 90 days. */
export function warmIndex(data: Data, now = new Date()): WarmIndex {
  if (memo && now.getTime() - memo.at < FRESH_MS && now.getTime() >= memo.at) return memo.index
  const since = new Date(now.getTime() - DAYS * DAY).toISOString()
  const recent = (at: string | null | undefined): at is string => Boolean(at && at >= since)

  const companies = new Map((data.companies ?? []).map((c) => [c.id, c]))
  const contacts = new Map((data.contacts ?? []).map((c) => [c.email.toLowerCase(), c]))
  // A contact's company: their work email's domain, else the company they're linked to.
  const companyOf = (email: string): { key: string; domain: string | null; companyId: string | null } | null => {
    const address = email.toLowerCase()
    const contact = contacts.get(address)
    const linked = contact?.company_id ? companies.get(contact.company_id) : undefined
    const domain = workDomain(address) ?? linked?.domain?.toLowerCase() ?? null
    if (domain) return { key: domain, domain, companyId: linked?.id ?? null }
    return linked ? { key: `company:${linked.id}`, domain: null, companyId: linked.id } : null
  }

  const byKey = new Map<string, Tally>()
  const byEmail = new Map<string, Tally>()
  const note = (email: string | null | undefined, at: string, add: (t: Tally) => void) => {
    if (!email) return
    const company = companyOf(email)
    for (const [map, key] of [
      [byEmail, email.toLowerCase()],
      [byKey, company?.key],
    ] as const) {
      if (!key) continue
      const t = map.get(key) ?? blank()
      t.companyId ??= company?.companyId ?? null
      t.domain ??= company?.domain ?? null
      add(t)
      t.lastAt = later(t.lastAt, at)
      map.set(key, t)
    }
  }

  for (const r of data.campaign_recipients ?? []) {
    const email = r.contact_email
    if (recent(r.replied_at)) note(email, r.replied_at, (t) => void t.replies++)
    if (recent(r.clicked_at)) note(email, r.clicked_at, (t) => void t.clicks++)
    // opened_at and clicked_at are people's only: scanners' loads and clicks are judged out of them (db.ts judgeOpens, judgeClicks).
    if (recent(r.opened_at)) note(email, r.opened_at, (t) => void t.openers.add(email.toLowerCase()))
    for (const at of [r.complained_at, r.unsubscribed_at]) if (recent(at)) note(email, at, (t) => void (t.cancelled = true))
  }
  for (const e of data.sequence_enrollments ?? []) if (recent(e.replied_at)) note(e.contact_email, e.replied_at, (t) => void t.replies++)
  for (const f of data.form_submissions ?? []) if (recent(f.submitted_at)) note(f.contact_email, f.submitted_at, (t) => void t.forms++)
  for (const s of data.survey_responses ?? []) if (s.status === 'completed' && recent(s.completed_at)) note(s.contact_email, s.completed_at, (t) => void t.forms++)

  // Proposals are a deal's, and a deal is with a company.
  const deals = new Map((data.deals ?? []).map((d) => [d.id, d]))
  for (const p of data.proposals ?? []) {
    const company = deals.get(p.deal_id)?.company_id ? companies.get(deals.get(p.deal_id)!.company_id!) : undefined
    if (!company) continue
    const key = company.domain?.toLowerCase() || `company:${company.id}`
    const add = (at: string | null, count: (t: Tally) => void) => {
      if (!recent(at)) return
      const t = byKey.get(key) ?? blank()
      t.companyId ??= company.id
      t.domain ??= company.domain?.toLowerCase() ?? null
      count(t)
      t.lastAt = later(t.lastAt, at)
      byKey.set(key, t)
    }
    if (p.views > 0) add(p.last_viewed_at, (t) => void t.proposalViews++)
    add(p.accepted_at, (t) => void t.accepted++)
  }

  // A company's LinkedIn id: the CRM's, or the one prospect search found for its domain.
  // The host's verified search keeps a company by its page name (slug) instead, so that's kept too.
  const numeric = (ref: string | null | undefined): ref is string => Boolean(ref && /^\d+$/.test(ref))
  const prospectByDomain = new Map<string, NonNullable<Data['prospect_companies']>[number]>()
  for (const c of data.prospect_companies ?? []) {
    if (!c.domain) continue
    const d = c.domain.toLowerCase()
    const had = prospectByDomain.get(d)
    if (!had || (numeric(c.ref) && !numeric(had.ref))) prospectByDomain.set(d, c)
  }
  const prospectByRef = new Map((data.prospect_companies ?? []).map((c) => [c.ref, c]))
  // Someone at a company's domain who isn't linked to it is still at that company.
  const companyByDomain = new Map<string, NonNullable<Data['companies']>[number]>()
  for (const c of data.companies ?? []) if (c.domain && !companyByDomain.has(c.domain.toLowerCase())) companyByDomain.set(c.domain.toLowerCase(), c)
  const slugOf = (ref: string | null | undefined, slug?: string | null) => slug?.trim() || (ref && !numeric(ref) ? ref : null)

  const summary = (key: string, t: Tally): WarmSummary | null => {
    const warm = !t.cancelled && (t.replies + t.clicks + t.forms + t.proposalViews + t.accepted > 0 || t.openers.size >= 2)
    if (!warm) return null
    const company = (t.companyId ? companies.get(t.companyId) : undefined) ?? (t.domain ? companyByDomain.get(t.domain) : undefined)
    const prospect = t.domain ? prospectByDomain.get(t.domain) : undefined
    const ref = numeric(company?.linkedin_ref) ? company.linkedin_ref : numeric(prospect?.ref) ? prospect.ref : null
    const page = ref ? prospectByRef.get(ref) : prospect
    const slug = slugOf(company?.linkedin_ref) ?? slugOf(page?.ref, page?.slug)
    return {
      key,
      companyId: company?.id ?? null,
      domain: t.domain,
      ref,
      slug,
      name: company?.name ?? page?.name ?? null,
      replies: t.replies,
      clicks: t.clicks,
      openers: t.openers.size,
      forms: t.forms,
      proposalViews: t.proposalViews,
      accepted: t.accepted,
      lastAt: t.lastAt,
    }
  }

  const warm = [...byKey].map(([key, t]) => summary(key, t)).filter((s): s is WarmSummary => Boolean(s))
  warm.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
  const index: WarmIndex = { all: warm.slice(0, MAX_COMPANIES), byDomain: new Map(), byRef: new Map(), byEmail: new Map() }
  for (const s of index.all) {
    if (s.domain) index.byDomain.set(s.domain, s)
    if (s.ref) index.byRef.set(s.ref, s)
  }
  for (const [email, t] of byEmail) {
    const s = summary(email, t)
    if (s) index.byEmail.set(email, s)
  }
  memo = { at: now.getTime(), index }
  return index
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What the badge says: the strongest thing first, counts only. */
export function warmSignal(s: WarmSummary, own = false): Signal {
  const parts = [
    s.accepted ? `${plural(s.accepted, 'proposal')} accepted` : null,
    s.replies ? plural(s.replies, 'reply', 'replies') : null,
    s.proposalViews ? `${plural(s.proposalViews, 'proposal')} viewed` : null,
    s.clicks ? plural(s.clicks, 'click') : null,
    s.forms ? plural(s.forms, 'form') : null,
    s.openers && !own ? `${plural(s.openers, 'person', 'people')} opened` : s.openers ? 'opened' : null,
  ].filter(Boolean) as string[]
  return {
    kind: 'warm',
    label: `Warm · ${parts[0] ?? 'engaged'}`,
    detail: `${own ? 'This person' : 'At this company'}, in the last 90 days: ${parts.join(', ')}.`,
    at: s.lastAt || null,
    url: s.companyId ? `/marketing/companies/${s.companyId}` : null,
    source: 'workspace',
  }
}

/** The company-level warm signal for a search result, by its domain or LinkedIn id. */
export function warmFor(index: WarmIndex, c: { domain?: string | null; ref?: string | null }): Signal | null {
  const s = (c.domain ? index.byDomain.get(c.domain.toLowerCase().replace(/^www\./, '')) : undefined) ?? (c.ref ? index.byRef.get(c.ref) : undefined)
  return s ? warmSignal(s) : null
}

/** Warm companies to search inside: those with a LinkedIn id, most recent first. */
export function warmTargets(index: WarmIndex): Array<{ ref: string; name: string }> {
  return [...index.byRef.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).map((s) => ({ ref: s.ref!, name: s.name ?? s.domain ?? '' }))
}

/** Warm companies the Warm filter can't search inside: no LinkedIn id known. */
export const warmWithoutRef = (index: WarmIndex) => [...index.byDomain.values()].filter((s) => !s.ref).length

/**
 * Warm companies for the host's verified search, which goes inside a company by
 * its name or its LinkedIn page name (`ref` here: the slug, or '' where none is
 * known), most recent first. One per name.
 */
export function warmTargetsByName(index: WarmIndex): Array<{ ref: string; name: string; summary: WarmSummary }> {
  const seen = new Set<string>()
  const out: Array<{ ref: string; name: string; summary: WarmSummary }> = []
  for (const s of index.all) {
    const name = s.name?.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({ ref: s.slug ?? '', name, summary: s })
  }
  return out
}

/** Warm companies the host's verified search can't go inside: no company name known, only an email domain. */
export const warmWithoutName = (index: WarmIndex) => index.all.filter((s) => !s.name?.trim()).length
