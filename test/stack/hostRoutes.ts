// The stand-in host's answers, one route per outside API the app calls, in
// the shapes the app's own client code reads (the file that reads each is
// named on it). Anything the app calls that isn't here gets a 404 and a line
// in host.log, so a missing stand-in shows up rather than passing quietly.

import type { Zone } from './dns'
import type { Overrides } from './host'
import { COMPANIES, PEOPLE, companyById, companyByDomain, companyBySlug, personBySlug, profileUrl, verdict, type FakeCompany, type FakePerson } from './fixtures'

export interface Ctx {
  zone: Zone
  overrides: () => Overrides
  appUrl: string
  secret: string
  mode: 'hosted' | 'self-hosted'
}

interface RouteArgs {
  request: Request
  url: URL
  body: any
  params: string[]
  ctx: Ctx
}

export interface Route {
  method: string
  path: string | RegExp
  handle: (args: RouteArgs) => Response | Promise<Response>
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers })
const data = (d: unknown) => json({ data: d, meta: { requestId: crypto.randomUUID(), creditsCharged: 1 } })
const now = () => new Date().toISOString()

const COUNTRY_NAMES: Record<string, string> = { GB: 'United Kingdom', US: 'United States', DE: 'Germany' }
const countryMatches = (code: string, asked: string) => {
  const a = asked.trim().toLowerCase()
  return !a || a === code.toLowerCase() || (COUNTRY_NAMES[code] ?? '').toLowerCase().includes(a) || (a === 'uk' && code === 'GB')
}
const titleMatches = (title: string, asked: string) => {
  const t = title.toLowerCase()
  const a = asked.replace(/_/g, ' ').trim().toLowerCase()
  return !a || t.includes(a) || a.split(/\s+/).every((w) => t.includes(w))
}

function sizeBand(n: number) {
  for (const [lo, hi] of [[1, 10], [11, 50], [51, 200], [201, 500], [501, 1000], [1001, 5000], [5001, 10000]] as const) if (n <= hi) return `${lo}-${hi}`
  return '10001+'
}

// ── SocialFetch shapes (prospecting/socialfetch.ts) ─────────────────────────

const org = (c: FakeCompany) => ({
  liveOrganizationId: c.id,
  slug: c.slug,
  universalName: c.slug,
  name: c.name,
  website: `https://www.${c.domain}`,
  industry: c.industry,
  staffCount: c.headcount,
  staffCountRange: sizeBand(c.headcount),
  type: 'Privately Held',
  headquarter: { country: COUNTRY_NAMES[c.country], countryCode: c.country },
  url: `https://www.linkedin.com/company/${c.slug}/`,
})

const position = (p: FakePerson) => {
  const c = companyById(p.companyId)!
  return {
    isCurrent: true,
    title: p.title,
    organizationId: c.id,
    organization: { id: c.id, name: c.name, url: `https://www.linkedin.com/company/${c.slug}/` },
    organizationName: c.name,
    organizationSlug: c.slug,
    startedOn: p.since,
  }
}

const person = (p: FakePerson) => ({
  profileUrl: profileUrl(p),
  handle: p.slug,
  firstName: p.first,
  lastName: p.last,
  fullName: `${p.first} ${p.last}`,
  headline: `${p.title} at ${companyById(p.companyId)!.name}`,
  currentPositions: [position(p)],
  geo: { country: p.country },
  geoCountry: p.country,
})

/** The host relay's minimised person (verifiedPeopleSource.ts HostPerson). */
const hostPerson = (p: FakePerson) => {
  const c = companyById(p.companyId)!
  return {
    profileUrl: profileUrl(p),
    name: `${p.first} ${p.last}`,
    title: p.title,
    titleVerified: true,
    country: p.country,
    company: { name: c.name, slug: c.slug, url: `https://www.linkedin.com/company/${c.slug}/`, industry: c.industry, sizeBand: sizeBand(c.headcount), employees: c.headcount, website: `https://www.${c.domain}` },
  }
}

const searches = new Map<string, FakePerson[]>()

// ── AI (copilot/providers/anthropic.ts; copilot/managedAi.ts) ───────────────

/** A made-up value that fits a JSON schema, for the AI's answer tools. */
function fake(schema: any, key = ''): unknown {
  if (!schema || typeof schema !== 'object') return null
  if (schema.enum) return schema.enum[0]
  if (schema.const !== undefined) return schema.const
  if (schema.anyOf) return fake(schema.anyOf.find((s: any) => s.type !== 'null') ?? schema.anyOf[0], key)
  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') : schema.type
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [k, s] of Object.entries(schema.properties ?? {})) out[k] = fake(s, k)
      return out
    }
    case 'array':
      return Array.from({ length: Math.max(1, schema.minItems ?? 1) }, () => fake(schema.items, key))
    case 'integer':
    case 'number':
      return schema.minimum ?? 1
    case 'boolean':
      return true
    case 'string':
      if (/url|source|link|website/i.test(key)) return 'https://www.copperwick.test/about'
      if (/title/i.test(key)) return 'Head of Marketing'
      if (/country/i.test(key)) return 'GB'
      if (/domain/i.test(key)) return 'copperwick.test'
      return `Stand-in ${key || 'text'}`
    default:
      return null
  }
}

const EMAIL_BODY =
  'Hi there, teams your size usually lose a few hours a week chasing the same updates by hand. We take that off your plate so the people doing the work can get on with it. Would a short call next week be useful?'

/** The AI's answer to one request: a queued override, a written answer tool, or a chat reply. */
function aiAnswer(body: any, ctx: Ctx) {
  const queued = ctx.overrides().ai.shift()
  const tools: Array<{ name?: string; input_schema?: unknown }> = body?.tools ?? []
  const toolUse = (name: string, input: unknown) => ({ type: 'tool_use', id: `toolu_${crypto.randomUUID().replace(/-/g, '')}`, name, input })
  let content: unknown[]
  if (queued?.toolUse) content = [toolUse(queued.toolUse.name, queued.toolUse.input)]
  else if (queued?.text) content = [{ type: 'text', text: queued.text }]
  else {
    const answerTool = tools.find((t) => ['suggestPersonas', 'suggestSearch', 'companyFacts', 'writeEmail', 'writeFollowUp', 'writeReply'].includes(t.name ?? ''))
    switch (answerTool?.name) {
      case 'writeEmail':
        content = [toolUse('writeEmail', { subject: 'An idea for your team', body: EMAIL_BODY, facts_used: [] })]
        break
      case 'writeFollowUp':
        content = [toolUse('writeFollowUp', { body: 'One more thought: when a team grows past forty people, the hand-offs are usually where time goes missing. We make those hand-offs automatic. Is that something you are looking at this quarter?', facts_used: [] })]
        break
      case 'writeReply':
        content = [toolUse('writeReply', { body: 'Thanks for getting back to me. Happy to send over a short summary, or we could find twenty minutes next week if that is easier.' })]
        break
      case undefined:
        content = [{ type: 'text', text: 'Stand-in reply from the test stack. Nothing was done.' }]
        break
      default:
        content = [toolUse(answerTool!.name!, fake(answerTool!.input_schema))]
    }
  }
  const stop = content.some((c: any) => c.type === 'tool_use') ? 'tool_use' : 'end_turn'
  return {
    id: `msg_${crypto.randomUUID().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    model: body?.model ?? 'stand-in',
    content,
    stop_reason: stop,
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}

// ── Sending domains (sendingDomains.ts) and warmup (inboxWarmup.ts) ─────────

const domainChecks = new Map<string, number>()
const warmupSenders = new Map<string, any>()
let billingPlan: Record<string, number> = { prospects: 2000, reveals: 400, emails: 20000, ai: 10, warmup: 1 }

function domainAnswer(domain: string, ctx: Ctx) {
  const checks = (domainChecks.get(domain) ?? 0) + 1
  domainChecks.set(domain, checks)
  const records = [
    { type: 'CNAME', name: `magpie._domainkey.${domain}`, value: 'dkim.magpie.test', purpose: 'DKIM: proves the mail is yours' },
    { type: 'TXT', name: domain, value: 'v=spf1 include:spf.magpie.test ~all', purpose: 'SPF' },
    { type: 'TXT', name: `_dmarc.${domain}`, value: 'v=DMARC1; p=none', purpose: 'DMARC', optional: true },
  ]
  // Ready from the second check, as if the records had been added in between ("Check now").
  const ready = checks >= 2 || (ctx.overrides().domainsReady as string[] | undefined)?.includes(domain) === true
  if (ready) {
    ctx.zone.set(domain, [{ type: 'MX', preference: 10, exchange: 'mail.magpie.test' }, { type: 'TXT', text: 'v=spf1 include:spf.magpie.test ~all' }])
    ctx.zone.set(`_dmarc.${domain}`, [{ type: 'TXT', text: 'v=DMARC1; p=none' }])
  }
  return { ready, records, ...(ready ? {} : { waitingFor: 'DKIM' }) }
}

const warmupSender = (address: string, state: string) => ({
  address,
  state,
  pausedBy: state === 'paused' ? 'you' : null,
  reason: null,
  health: { state: 'healthy', score: 92, reason: null, until: null },
  today: { sent: 4, target: 10 },
  ceiling: 20,
  daysActive: 3,
  week: { sent: 21, replied: 9, spam: 0 },
  partners: null,
  problem: null,
})

const tally = (inbox: number, tabs: number, spam: number) => ({ inbox, tabs, spam })

// ── Billing (managedBilling.ts) ─────────────────────────────────────────────

function billingStatus() {
  const start = new Date()
  start.setUTCDate(1)
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  return {
    managed: true,
    status: 'active',
    live: true,
    plan: billingPlan,
    nextPlan: billingPlan,
    monthlyPence: 4500,
    currency: 'gbp',
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    cancelAt: null,
    cancelFeedback: null,
    endedAt: null,
    suspendOn: null,
    catalogue: {
      minimumPence: 1000,
      cancelReasons: [
        { id: 'price', label: 'It costs too much' },
        { id: 'other', label: 'Something else' },
      ],
      kinds: [
        { id: 'prospects', name: 'Prospects', unit: 'person found', per: 1, steps: [0, 500, 1000, 2000, 5000], unitMillipence: 400 },
        { id: 'reveals', name: 'Email lookups', unit: 'work email found and verified', per: 1, steps: [0, 100, 200, 400, 1000], unitMillipence: 2000, maxShareOf: { kind: 'prospects', share: 0.3 } },
        { id: 'emails', name: 'Emails', unit: 'email sent', per: 1000, steps: [0, 5000, 10000, 20000, 50000], unitMillipence: 15 },
        { id: 'ai', name: 'AI', unit: 'pound of AI use', per: 1, steps: [0, 5, 10, 20], unitMillipence: 100000 },
      ],
      addons: [{ id: 'warmup', name: 'Inbox warmup', unit: 'one sender warmed with up to 20 emails a day', unitMillipence: 500000, available: true, note: null }],
    },
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

export const routes: Route[] = [
  // The host's rules (prospecting/hostRules.ts). /__control {"rules": {...}} changes them.
  {
    method: 'GET',
    path: '/v1/prospecting',
    handle: ({ ctx }) =>
      json({
        rules: { formatConfirmed: 0.85, firstBatch: 50, holdHours: 1, maxBounceRate: 0.02 },
        formatSharing: true,
        eventsPending: false,
        checks: { perMinute: 600, perDay: 100000 },
        sendLimits: { cold: 500, optIn: 5000 },
        pool: { available: true, search: true, contributing: true, byDefault: true, termsVersion: 'stand-in-1', termsUrl: 'https://www.magpie.test/contributor-terms' },
        profileLookupsFree: false,
        webSearch: true,
        signals: true,
        noTitleBatches: true,
        verifiedPeopleSearch: true,
        inboxWarmup: { available: true, maxSenders: 1, signal: 'healthy' },
        ...((ctx.overrides().rules as object) ?? {}),
      }),
  },

  // Email verification (prospecting/reacher.ts): fixtures.ts decides who's real.
  {
    method: 'POST',
    path: '/v1/check_email',
    handle: ({ body }) => {
      const is = verdict(String(body?.to_email ?? ''))
      return json({ input: body?.to_email, is_reachable: is, smtp: { is_catch_all: is === 'risky', is_deliverable: is === 'safe' } })
    },
  },
  {
    method: 'POST',
    path: '/v1/formats',
    handle: ({ body }) => json(body?.ask ? { answers: body.ask.map(() => ({ counts: null })) } : { ok: true }),
  },
  {
    method: 'POST',
    path: '/v1/catch-all',
    handle: ({ body }) =>
      json({
        companies: (body?.companies ?? []).map((c: { ref?: string; domain?: string }) => {
          const known = (c.domain && companyByDomain(c.domain)) || (c.ref && companyBySlug(c.ref))
          return known ? { catchAll: known.format === 'catch-all', checkedAt: now(), confirmed: true } : {}
        }),
      }),
  },

  // The shared database (prospecting/sharedPeople.ts): knows nobody, takes what's given.
  { method: 'POST', path: '/v1/pool/known', handle: () => json({ people: [] }) },
  { method: 'POST', path: '/v1/pool/reveal', handle: () => json({ error: 'not known' }, 404) },
  { method: 'POST', path: '/v1/pool/membership', handle: ({ body }) => json({ contributing: !!body?.contribute }) },
  { method: 'POST', path: '/v1/pool/contribute', handle: ({ body }) => json({ accepted: (body?.people ?? []).length, full: 0 }) },

  // Web search (prospecting/webSearch.ts): a company's website when its name is asked for.
  {
    method: 'POST',
    path: '/v1/web-search',
    handle: ({ body }) => {
      const q = String(body?.query ?? '').toLowerCase()
      const hits = COMPANIES.filter((c) => q.includes(c.name.toLowerCase()) || q.includes(c.domain))
      return json({ results: hits.map((c) => ({ url: `https://www.${c.domain}/`, title: `${c.name}: home`, description: `${c.name}, ${c.industry}.` })) })
    },
  },
  {
    method: 'POST',
    path: '/v1/company-signals',
    handle: ({ body }) => {
      const signals: Record<string, unknown[]> = {}
      const kinds: string[] = body?.kinds ?? []
      for (const c of body?.companies ?? []) {
        const known = (c.domain && companyByDomain(c.domain)) || COMPANIES.find((k) => k.name.toLowerCase() === String(c.name).toLowerCase())
        const found: unknown[] = []
        if (known?.hiring && kinds.includes('hiring')) found.push({ kind: 'hiring', label: 'Hiring', detail: 'Hiring for 3 roles', at: now(), url: `https://www.${known.domain}/careers`, source: 'web' })
        if (known?.funding && kinds.includes('funding')) found.push({ kind: 'funding', label: 'Raised funding', detail: known.funding, at: now(), url: `https://www.${known.domain}/news`, source: 'web' })
        signals[c.key] = found
      }
      return json({ signals, pending: [] })
    },
  },

  // Inbox warmup (inboxWarmup.ts).
  {
    method: 'GET',
    path: '/v1/inbox-warmup',
    handle: () => json({ available: true, stopped: null, maxSenders: 1, senders: [...warmupSenders.values()], placementTests: { used: 0, limit: 3 } }),
  },
  {
    method: 'PUT',
    path: /^\/v1\/inbox-warmup\/senders\/([^/]+)$/,
    handle: ({ params }) => {
      const address = decodeURIComponent(params[0])
      const s = warmupSender(address, 'warming')
      warmupSenders.set(address, s)
      return json(s)
    },
  },
  {
    method: 'POST',
    path: /^\/v1\/inbox-warmup\/senders\/([^/]+)\/(pause|resume)$/,
    handle: ({ params }) => {
      const address = decodeURIComponent(params[0])
      const s = warmupSender(address, params[1] === 'pause' ? 'paused' : 'warming')
      warmupSenders.set(address, s)
      return json(s)
    },
  },
  {
    method: 'DELETE',
    path: /^\/v1\/inbox-warmup\/senders\/([^/]+)$/,
    handle: ({ params }) => {
      warmupSenders.delete(decodeURIComponent(params[0]))
      return new Response(null, { status: 204 })
    },
  },
  {
    method: 'GET',
    path: /^\/v1\/inbox-warmup\/senders\/([^/]+)\/stats$/,
    handle: () => {
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(Date.now() - (6 - i) * 86400_000).toISOString().slice(0, 10)
        return { date: d, sent: 2 + i, replied: 1 + (i >> 1), received: 2 + i, target: 2 + i }
      })
      return json({ days })
    },
  },
  {
    method: 'GET',
    path: '/v1/inbox-warmup/placement',
    handle: () => json({ senders: [...warmupSenders.keys()].map((address) => ({ address, major: tally(18, 2, 1), all: tally(20, 2, 1) })), daily: [] }),
  },
  { method: 'POST', path: '/v1/inbox-warmup/sender-check', handle: () => json({ id: `pt_${Date.now()}`, seeds: 6 }) },
  {
    method: 'GET',
    path: /^\/v1\/inbox-warmup\/placement-tests\/([^/]+)$/,
    handle: ({ params }) =>
      json({
        id: params[0],
        status: 'done',
        startedAt: now(),
        families: [
          { family: 'google', ...tally(2, 0, 0), missing: 0, waiting: 0 },
          { family: 'microsoft', ...tally(1, 0, 1), missing: 0, waiting: 0 },
          { family: 'other', ...tally(2, 0, 0), missing: 0, waiting: 0 },
        ],
      }),
  },

  // The copilot and the AI's writing, through the host (copilot/managedAi.ts).
  {
    method: 'POST',
    path: '/v1/ai/messages',
    handle: ({ body, ctx }) => json(aiAnswer(body, ctx), 200, { 'x-magpie-ai-charge': '250' }),
  },

  // ── SocialFetch, or the host's relay (prospecting/socialfetch.ts) ─────────
  {
    method: 'GET',
    path: '/v2/linkedin/organizations/search',
    handle: ({ url }) => {
      const kw = (url.searchParams.get('keyword') ?? '').toLowerCase()
      const start = Number(url.searchParams.get('start') ?? 0)
      const count = Number(url.searchParams.get('count') ?? 50)
      const all = COMPANIES.filter((c) => !kw || c.name.toLowerCase().includes(kw) || c.industry.toLowerCase().includes(kw))
      const page = all.slice(start, start + count)
      return data({ organizations: page.map(org), page: { hasMore: start + count < all.length, start, returnedCount: page.length, total: all.length }, reportedTotal: all.length })
    },
  },
  {
    method: 'GET',
    path: '/v1/linkedin/companies',
    handle: ({ url }) => {
      const slug = /\/company\/([^/?#]+)/.exec(url.searchParams.get('url') ?? '')?.[1] ?? ''
      const c = companyBySlug(slug)
      if (!c) return data({ lookupStatus: 'not_found' })
      return data({
        lookupStatus: 'found',
        company: { id: c.id, name: c.name, website: `https://www.${c.domain}`, industry: c.industry, employeeRange: sizeBand(c.headcount), location: { country: c.country }, companyUrl: `https://www.linkedin.com/company/${c.slug}/`, url: `https://www.linkedin.com/company/${c.slug}/` },
        metrics: { employees: c.headcount },
      })
    },
  },
  {
    method: 'GET',
    path: '/v2/linkedin/organizations',
    handle: ({ url }) => {
      const c = companyBySlug(url.searchParams.get('slug') ?? url.searchParams.get('id') ?? '')
      return data(c ? { lookupStatus: 'found', organization: org(c) } : { lookupStatus: 'not_found' })
    },
  },
  {
    method: 'GET',
    path: '/v2/linkedin/people/search',
    handle: ({ url }) => {
      const title = url.searchParams.get('title') ?? ''
      const kw = (url.searchParams.get('keyword') ?? '').toLowerCase()
      const companies = (url.searchParams.get('currentCompany') ?? '').split(',').filter(Boolean)
      const start = Number(url.searchParams.get('start') ?? 0)
      const count = Number(url.searchParams.get('count') ?? 50)
      const all = PEOPLE.filter(
        (p) => titleMatches(p.title, title) && (!companies.length || companies.includes(p.companyId) || companies.includes(companyById(p.companyId)!.slug)) && (!kw || `${p.first} ${p.last} ${p.title}`.toLowerCase().includes(kw)),
      )
      const page = all.slice(start, start + count)
      return data({ people: page.map(person), page: { hasMore: start + count < all.length, start, returnedCount: page.length }, reportedTotal: all.length, lookupStatus: 'found' })
    },
  },
  {
    method: 'GET',
    path: '/v2/linkedin/profiles',
    handle: ({ url }) => {
      const slug = /\/in\/([^/?#]+)/.exec(url.searchParams.get('handle') ?? '')?.[1] ?? url.searchParams.get('handle') ?? ''
      const p = personBySlug(slug)
      return data(p ? { lookupStatus: 'found', profile: person(p) } : { lookupStatus: 'not_found' })
    },
  },
  { method: 'GET', path: '/v1/balance', handle: () => data({ balance: null }) },

  // The host's verified people search, started then read page by page (verifiedPeopleSource.ts).
  {
    method: 'POST',
    path: '/v2/linkedin/people/searches',
    handle: ({ body }) => {
      const titles: string[] = body?.titles ?? []
      const locations: string[] = body?.locations ?? []
      const slugs: string[] = body?.companySlugs ?? []
      const names: string[] = (body?.companies ?? []).map((n: string) => n.toLowerCase())
      const found = PEOPLE.filter((p) => {
        const c = companyById(p.companyId)!
        return (
          (!titles.length || titles.some((t) => titleMatches(p.title, t))) &&
          (!locations.length || locations.some((l) => countryMatches(p.country, l))) &&
          (!slugs.length || slugs.includes(c.slug)) &&
          (!names.length || names.includes(c.name.toLowerCase()))
        )
      }).slice(0, body?.limit ?? 200)
      const id = `srch_${crypto.randomUUID()}`
      searches.set(id, found)
      return json({ id })
    },
  },
  {
    method: 'GET',
    path: /^\/v2\/linkedin\/people\/searches\/([^/]+)$/,
    handle: ({ params, url }) => {
      const found = searches.get(params[0])
      if (!found) return json({ error: 'no such search' }, 404)
      const cursor = Number(url.searchParams.get('cursor') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 50)
      const page = found.slice(cursor, cursor + limit)
      const next = cursor + limit < found.length ? cursor + limit : null
      return json({ status: 'done', found: found.length, next_cursor: next, people: page.map(hostPerson), stats: { searches: 1, engineErrors: 0, siteIgnored: 0, candidates: found.length, rejected: {} } })
    },
  },
  {
    method: 'DELETE',
    path: /^\/v2\/linkedin\/people\/searches\/([^/]+)$/,
    handle: ({ params }) => {
      searches.delete(params[0])
      return new Response(null, { status: 204 })
    },
  },

  // ── Managed sending domains (sendingDomains.ts) ──────────────────────────
  { method: 'PUT', path: /^\/v1\/mta\/domains\/([^/]+)$/, handle: ({ params, ctx }) => json(domainAnswer(decodeURIComponent(params[0]).toLowerCase(), ctx)) },
  {
    method: 'DELETE',
    path: /^\/v1\/mta\/domains\/([^/]+)$/,
    handle: ({ params }) => {
      domainChecks.delete(decodeURIComponent(params[0]).toLowerCase())
      return new Response(null, { status: 204 })
    },
  },

  // ── Managed billing (managedBilling.ts), at MANAGED_BILLING_URL = /v1/billing/test ──
  { method: 'GET', path: '/v1/billing/test', handle: () => json(billingStatus()) },
  {
    method: 'POST',
    path: '/v1/billing/test/plan',
    handle: ({ body }) => {
      billingPlan = { ...billingPlan, ...(body?.plan ?? {}) }
      return json({ changed: 'both' })
    },
  },
  { method: 'POST', path: '/v1/billing/test/cancel', handle: () => json({}) },
  { method: 'POST', path: '/v1/billing/test/resume', handle: () => json({}) },
  // The app accepts only Stripe's own addresses here; nothing in the stack follows them.
  { method: 'POST', path: '/v1/billing/test/checkout', handle: () => json({ url: 'https://checkout.stripe.com/c/pay/stand-in' }) },
  { method: 'POST', path: '/v1/billing/test/checkout/finish', handle: () => json({}) },
  { method: 'POST', path: '/v1/billing/test/portal-session', handle: () => json({ url: 'https://billing.stripe.com/p/session/stand-in' }) },

  // ── Self-hosted only: Decodo's Google results (prospecting/webSearch.ts) ──
  {
    method: 'POST',
    path: '/v1/scrape',
    handle: ({ body }) => {
      const q = String(body?.query ?? '').toLowerCase()
      const organic: unknown[] = []
      for (const c of COMPANIES) if (q.includes(c.name.toLowerCase())) organic.push({ url: `https://www.${c.domain}/`, title: `${c.name}: home`, desc: `${c.name}, ${c.industry}.` })
      if (q.includes('linkedin.com/in'))
        for (const p of PEOPLE.filter((p) => q.split(/"/).some((part) => part && titleMatches(p.title, part))).slice(0, 10)) {
          const c = companyById(p.companyId)!
          organic.push({ url: profileUrl(p), title: `${p.first} ${p.last} - ${p.title} - ${c.name} | LinkedIn`, desc: `${COUNTRY_NAMES[p.country]} · ${p.title} at ${c.name}` })
        }
      return json({ results: [{ content: { results: { organic } } }], status_code: 200 })
    },
  },
]

