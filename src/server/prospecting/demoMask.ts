// Demo mode (DEMO_MODE=on): a copy for showing the product to people. Its
// prospect search runs for real, so it shows how search behaves, but nobody
// it finds is shown: names, companies, domains, emails, links and the pages'
// cursors are masked here, before anything leaves the server, so they aren't
// in the page's data either. "Jane Smith at Acme Widgets" goes out as
// "J*** S*** at A*** W***", and her email as "j***@a***.com".
//
// The real records stay in this server's memory (the vault), under random-
// looking tokens the masked copies carry in place of profile links, company
// refs and cursors. A Reveal, a company picked to search inside, the next
// page, or a company's signals come back with those tokens, and are looked up
// here before anything runs. The vault is never written to disk, holds at
// most VAULT_MAX entries, and forgets each after a day (or a restart), after
// which the page says to search again.
//
// People found can't be saved in demo mode (search.ts startSave): the
// workspace's contacts are made up, and stay that way.

import { createHmac, randomBytes, randomUUID } from 'crypto'
import { env } from '../env'
import { signalKey } from './signals'
import type { CompanyResult, Page, PersonResult, Signal } from './types'

export const demoMode = () => env.demoMode()

export const DEMO_SAVE_REFUSED = 'This is a demo workspace: people found in search can’t be saved here. Its contacts are made up.'
const EXPIRED = 'That search result has expired in this demo. Run the search again.'

// --- The vault ---------------------------------------------------------------

const VAULT_MAX = 20_000
const VAULT_KEPT_MS = 24 * 60 * 60_000
/** Per process: tokens only have to last as long as the vault, which a restart empties anyway. */
const TOKEN_KEY = randomBytes(32)

interface HeldCompany {
  ref: string | null
  name: string
  domain: string | null
  country: string | null
}

type Held = { kind: 'person'; person: PersonResult } | { kind: 'company'; company: HeldCompany } | { kind: 'cursor'; cursor: string }

const vault = new Map<string, { held: Held; at: number }>()

function keep(token: string, held: Held) {
  // Re-inserted, so the oldest entry is always first.
  vault.delete(token)
  vault.set(token, { held, at: Date.now() })
  while (vault.size > VAULT_MAX) vault.delete(vault.keys().next().value!)
}

function held(token: string): Held | undefined {
  const entry = vault.get(token)
  if (!entry) return undefined
  if (Date.now() - entry.at > VAULT_KEPT_MS) {
    vault.delete(token)
    return undefined
  }
  return entry.held
}

/** The same thing always gets the same token, so a person shown on two pages is the same row. */
const tokenFor = (kind: string, value: string) => createHmac('sha256', TOKEN_KEY).update(`${kind}\0${value}`).digest('base64url').slice(0, 20)

const PERSON_URL = 'https://demo.invalid/person/'
const COMPANY_REF = 'demo-co-'
const CURSOR = 'demo-cursor-'

/** For tests: forget everything held. */
export function clearDemoVault() {
  vault.clear()
}

// --- Masking text ------------------------------------------------------------

const STARS = '***'
/** Kept as they are in a masked company name: they say what kind of company, not which. */
const COMPANY_SUFFIXES = new Set(['ltd', 'ltd.', 'limited', 'inc', 'inc.', 'llc', 'llp', 'plc', 'gmbh', 'ag', 'sa', 'sas', 'bv', 'oy', 'ab', 'as', 'co', 'co.', 'corp', 'corp.', '&', 'and', 'the', 'group'])

const initial = (word: string) => {
  const first = [...word.trim()][0]
  return first ? first.toUpperCase() + STARS : ''
}

/** "Jane" → "J***". */
const maskPersonName = (name: string) => initial(name)

/** "Acme Widgets Ltd" → "A*** W*** Ltd". */
export function maskCompanyName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words.map((w) => (COMPANY_SUFFIXES.has(w.toLowerCase().replace(/,$/, '')) ? w : initial(w))).join(' ')
}

/** "acme-widgets.co.uk" → "a***.co.uk": what's after the first label is the public suffix, or near enough. */
export function maskDomain(domain: string): string {
  const [first, ...rest] = domain.trim().toLowerCase().split('.')
  return [`${[...first][0] ?? ''}${STARS}`, ...rest].join('.')
}

/** "jane.smith@acme.com" → "j***@a***.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return STARS
  return `${[...email][0].toLowerCase()}${STARS}@${maskDomain(email.slice(at + 1))}`
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Each real string in `text` replaced by its masked form, longest first. */
function scrub(text: string, pairs: Array<[string, string]>): string {
  let out = text
  for (const [real, masked] of [...pairs].sort((a, b) => b[0].length - a[0].length)) {
    if (real.trim().length < 2) continue
    out = out.replace(new RegExp(escape(real), 'gi'), masked)
  }
  return out
}

/**
 * A job title with no employer in it. Titles that come from a headline often
 * name one ("Head of Sales at Acme", "Founder @ Acme | ex-Initech"): anything
 * after "at" or "@" is masked word by word, anything after a "|" dropped, and
 * the person's own employer masked wherever it appears.
 */
export function maskTitle(title: string, company: string): string {
  const head = title.split(/\s+\|\s+|\s*\|\s*/)[0]
  const at = head.match(/^(.*?)(\s+at\s+|\s*@\s*)(.+)$/i)
  const kept = at ? `${at[1]}${at[2]}${maskCompanyName(at[3])}` : head
  return company ? scrub(kept, [[company, maskCompanyName(company)]]) : kept
}

/** A signal's badge, without where it was seen: a careers page or an article names the company. */
function maskSignals(signals: Signal[] | undefined): Signal[] | undefined {
  return signals?.map((s) => ({ ...s, url: null, detail: s.source === 'workspace' ? s.detail : undefined }))
}

// --- Companies -----------------------------------------------------------------

function companyToken(c: { ref: string | null; name: string }): string {
  return COMPANY_REF + tokenFor('company', c.ref ? `ref:${c.ref}` : `name:${c.name.trim().toLowerCase()}`)
}

function keepCompany(c: HeldCompany): string {
  const token = companyToken(c)
  keep(token, { kind: 'company', company: c })
  return token
}

export function maskCompany(c: CompanyResult): CompanyResult {
  const ref = keepCompany({ ref: c.ref, name: c.name, domain: c.domain, country: c.country })
  return {
    ...c,
    ref,
    name: maskCompanyName(c.name),
    domain: c.domain ? maskDomain(c.domain) : null,
    linkedinUrl: null,
    signals: maskSignals(c.signals),
    masked: true,
  }
}

/** The company a masked ref stands for. A ref that isn't one of ours is refused: in demo mode the page only has masked ones. */
export function unmaskCompanyRef(ref: string): HeldCompany {
  const found = ref.startsWith(COMPANY_REF) ? held(ref) : undefined
  if (found?.kind !== 'company') throw new Error(EXPIRED)
  return found.company
}

// --- People --------------------------------------------------------------------

export function maskPerson(p: PersonResult): PersonResult {
  const token = tokenFor('person', p.profileUrl)
  keep(token, { kind: 'person', person: p })
  // Masked like the real one: none where their company page isn't known.
  let companyRef: string | null = null
  if (p.company) {
    const companyToken = keepCompany({ ref: p.companyRef, name: p.company, domain: p.companyDomain, country: p.country })
    if (p.companyRef) companyRef = companyToken
  }
  const rest: PersonResult = { ...p }
  delete rest.otherJobs
  return {
    ...rest,
    profileUrl: PERSON_URL + token,
    firstName: maskPersonName(p.firstName),
    lastName: maskPersonName(p.lastName),
    title: maskTitle(p.title, p.company),
    company: p.company ? maskCompanyName(p.company) : '',
    companyRef,
    companySlug: null,
    companyDomain: p.companyDomain ? maskDomain(p.companyDomain) : null,
    ...(p.email ? { email: maskEmail(p.email) } : {}),
    ...(p.shared ? { shared: 'demo' } : {}),
    signals: maskSignals(p.signals),
    masked: true,
  }
}

/**
 * The real person behind a masked one sent back by the page. A company
 * website typed in by hand (no stars: the user's own input) is kept; the rest
 * comes from the vault.
 */
export function unmaskPerson(p: PersonResult): PersonResult {
  const found = p.profileUrl.startsWith(PERSON_URL) ? held(p.profileUrl.slice(PERSON_URL.length)) : undefined
  if (found?.kind !== 'person') throw new Error(EXPIRED)
  const typed = p.companyDomain && !p.companyDomain.includes('*') ? p.companyDomain : null
  return { ...found.person, ...(typed ? { companyDomain: typed } : {}), ...(p.searchId ? { searchId: p.searchId } : {}) }
}

const maskProfileUrl = (url: string) => PERSON_URL + tokenFor('person', url)

// --- Pages ---------------------------------------------------------------------

function maskCursor(cursor: string | null): string | null {
  if (!cursor) return cursor
  const token = CURSOR + randomUUID()
  keep(token, { kind: 'cursor', cursor })
  return token
}

function unmaskCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return cursor
  const found = cursor.startsWith(CURSOR) ? held(cursor) : undefined
  if (found?.kind !== 'cursor') throw new Error(EXPIRED)
  return found.cursor
}

/** Every real name and domain on a page, with its masked form, for scrubbing the page's notes. */
function pairsFor(people: PersonResult[], companies: Array<{ name: string; domain: string | null }>): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (const c of companies) {
    pairs.push([c.name, maskCompanyName(c.name)])
    if (c.domain) pairs.push([c.domain, maskDomain(c.domain)])
  }
  for (const p of people) {
    if (p.company) pairs.push([p.company, maskCompanyName(p.company)])
    if (p.companyDomain) pairs.push([p.companyDomain, maskDomain(p.companyDomain)])
    const full = `${p.firstName} ${p.lastName}`.trim()
    if (full.includes(' ')) pairs.push([full, `${maskPersonName(p.firstName)} ${maskPersonName(p.lastName)}`])
  }
  return pairs
}

function maskNotes<T extends { warnings: string[]; details?: string[] }>(page: T, pairs: Array<[string, string]>): T {
  return { ...page, warnings: page.warnings.map((w) => scrub(w, pairs)), ...(page.details ? { details: page.details.map((d) => scrub(d, pairs)) } : {}) }
}

type PeopleInput = { company?: { ref: string; name: string } | null; cursor?: string }
type PeoplePage = Page<PersonResult> & { refined: string[]; resumed: boolean }
type PeopleOpts = { onPeople?: (found: { items: PersonResult[]; refined: string[] }) => void; listening?: () => boolean }

/** A people search in demo mode: what the page sent unmasked, what comes back masked, as it streams too. */
export async function demoPeopleSearch<I extends PeopleInput>(input: I, opts: PeopleOpts, run: (input: I, opts: PeopleOpts) => Promise<PeoplePage>): Promise<PeoplePage> {
  const company = input.company ? unmaskCompanyRef(input.company.ref) : null
  if (company && !company.ref) throw new Error(EXPIRED)
  const real = {
    ...input,
    ...(input.company !== undefined ? { company: company ? { ref: company.ref!, name: company.name } : null } : {}),
    cursor: unmaskCursor(input.cursor),
  }
  const onPeople = opts.onPeople
  const page = await run(real, {
    ...opts,
    ...(onPeople ? { onPeople: (found) => onPeople({ items: found.items.map(maskPerson), refined: found.refined.map(maskProfileUrl) }) } : {}),
  })
  const pairs = pairsFor(page.items, company ? [company] : [])
  return maskNotes(
    { ...page, items: page.items.map(maskPerson), refined: page.refined.map(maskProfileUrl), nextCursor: maskCursor(page.nextCursor) },
    pairs,
  )
}

/** A company search in demo mode. */
export async function demoCompanySearch<I extends { cursor?: string }>(input: I, run: (input: I) => Promise<Page<CompanyResult>>): Promise<Page<CompanyResult>> {
  const page = await run({ ...input, cursor: unmaskCursor(input.cursor) })
  const pairs = pairsFor([], page.items)
  return maskNotes({ ...page, items: page.items.map(maskCompany), nextCursor: maskCursor(page.nextCursor) }, pairs)
}

/** A company's website looked up in demo mode: asked by its masked ref, answered masked. */
export async function demoResolveCompany(
  ref: string,
  run: (ref: string) => Promise<{ ref: string; domain: string | null; catchAll: boolean }>,
): Promise<{ ref: string; domain: string | null; catchAll: boolean }> {
  const company = unmaskCompanyRef(ref)
  if (!company.ref) return { ref, domain: company.domain ? maskDomain(company.domain) : null, catchAll: false }
  const found = await run(company.ref)
  if (found.domain) keep(ref, { kind: 'company', company: { ...company, domain: found.domain } })
  return { ref, domain: found.domain ? maskDomain(found.domain) : null, catchAll: found.catchAll }
}

type RevealLike = { status: string; message?: string; email?: string; domain?: string; note?: string; suggestedDomain?: string }

/** A Reveal in demo mode: run for the real person, the address shown masked, and nothing in its wording naming them or their company. */
export async function demoReveal<R extends RevealLike>(person: PersonResult, run: (person: PersonResult) => Promise<R>): Promise<R> {
  const real = unmaskPerson(person)
  const result = await run(real)
  const pairs = pairsFor([real], [])
  const masked: R = { ...result }
  if (masked.email) masked.email = maskEmail(masked.email)
  if (masked.domain) masked.domain = maskDomain(masked.domain)
  if (masked.message) masked.message = scrub(masked.message, pairs)
  if (masked.note) masked.note = scrub(masked.note, pairs)
  // Offered in one click with the real domain in it: left out, the user can still type one.
  delete masked.suggestedDomain
  return masked
}

type SignalsAnswer = { signals: Record<string, Signal[]>; pending: string[] }

/**
 * Hiring and funding signals in demo mode. The page asks by each company's
 * masked ref (useCompanySignals), the lookup runs on the real companies, and
 * the answer is keyed by those refs again, without where each was seen.
 */
export async function demoCompanySignals(
  companies: Array<{ ref?: string }>,
  run: (companies: Array<{ name: string; domain: string | null; country: string | null }>) => Promise<SignalsAnswer>,
): Promise<SignalsAnswer> {
  const byKey = new Map<string, string[]>()
  const real: HeldCompany[] = []
  for (const c of companies) {
    const found = c.ref?.startsWith(COMPANY_REF) ? held(c.ref) : undefined
    if (found?.kind !== 'company') continue
    const key = signalKey(found.company)
    if (!key) continue
    if (!byKey.has(key)) real.push(found.company)
    byKey.set(key, [...(byKey.get(key) ?? []), c.ref!])
  }
  if (!real.length) return { signals: {}, pending: [] }
  const answer = await run(real.map((c) => ({ name: c.name, domain: c.domain, country: c.country })))
  const signals: Record<string, Signal[]> = {}
  for (const [key, found] of Object.entries(answer.signals)) for (const ref of byKey.get(key) ?? []) signals[ref] = maskSignals(found) ?? []
  return { signals, pending: answer.pending.flatMap((key) => byKey.get(key) ?? []) }
}
