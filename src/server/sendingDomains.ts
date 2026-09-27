// Sending domains, for a copy whose email is sent by its host's own mail
// server (SENDING_MANAGED=on). Users can't choose a provider or enter
// credentials; they add the domains they send from and put the DNS records
// shown here on them.
//
// The host keeps the domains and signs mail for each one with a DKIM key of
// its own per copy, so the DKIM record is also the proof that this copy's
// owner controls the domain: another copy's key is a different record. The
// host checks the records and refuses mail from domains that aren't ready;
// the copy mirrors that here to explain it before anything is sent.
//
// Host API (MANAGED_SENDING_URL, with this copy's SMTP login as Basic auth):
//   PUT    /v1/mta/domains/<domain>  adds it if new, checks DNS, and returns
//                                    { domain, ready, records, waitingFor? }
//   DELETE /v1/mta/domains/<domain>

import { db } from './db'
import { env } from './env'

export interface SendingDomain {
  domain: string
  /** The records to add, from the host. */
  records: DnsRecord[]
  /** The host found the records and will send from this domain. */
  ready: boolean
  /** From the host, while not ready: what it's still waiting for. */
  waitingFor?: string
  addedAt: string
  checkedAt: string | null
}

interface DnsRecord {
  type: 'CNAME' | 'TXT' | 'MX'
  name: string
  value: string
  purpose: string
  /** Recommended rather than required. */
  optional?: boolean
}

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** "Acme.com", "https://acme.com/", "jo@acme.com" → "acme.com"; null if it isn't a domain. */
export function normalizeDomain(input: string): string | null {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^.*@/, '')
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '')
  return DOMAIN.test(d) ? d : null
}

type HostApi = (method: 'PUT' | 'DELETE', domain: string) => Promise<{ status: number; json: any }>

/** A request to the host's domains API with this copy's SMTP login. */
const hostApi: HostApi = async (method, domain) => {
  const base = env.managedSendingUrl()
  const user = env.smtp.user()
  const pass = env.smtp.pass()
  if (!base || !user || !pass) throw new Error("Sending isn't set up on this server yet.")
  const res = await fetch(`${base}/v1/mta/domains/${encodeURIComponent(domain)}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` },
    signal: AbortSignal.timeout(15_000),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

export interface SendingDomainDeps {
  host?: HostApi
  now?: () => Date
}

const RECORD_TYPES = new Set(['CNAME', 'TXT', 'MX'])

/** Only well-formed records from the host's answer. */
function recordsFrom(json: any): DnsRecord[] {
  if (!Array.isArray(json?.records)) return []
  return json.records
    .filter((r: any) => RECORD_TYPES.has(r?.type) && typeof r.name === 'string' && typeof r.value === 'string')
    .map((r: any) => ({
      type: r.type,
      name: r.name,
      value: r.value,
      purpose: typeof r.purpose === 'string' ? r.purpose : '',
      ...(r.optional === true ? { optional: true } : {}),
    }))
}

/**
 * Stored domains. One saved before the host ran its own mail server has
 * no records yet: it shows as not ready, and the next check adds it on the
 * host, which returns the new records.
 */
const list = (): SendingDomain[] =>
  db.getSendingDomains().map((d: any) =>
    Array.isArray(d.records) ? d : { domain: d.domain, records: [], ready: false, addedAt: d.addedAt ?? new Date(0).toISOString(), checkedAt: null },
  )

export function getSendingDomains(): SendingDomain[] {
  return list()
}

function save(next: SendingDomain) {
  db.saveSendingDomains([...list().filter((d) => d.domain !== next.domain), next].sort((a, b) => a.domain.localeCompare(b.domain)))
}

/** Adds the domain on the host (or picks up the one already there) and checks its DNS. */
async function putOnHost(domain: string, addedAt: string, deps: SendingDomainDeps): Promise<SendingDomain> {
  const { status, json } = await (deps.host ?? hostApi)('PUT', domain)
  if (status !== 200) throw new Error(json?.error ?? `The sending service answered ${status}`)
  const ready = json?.ready === true
  return {
    domain,
    records: recordsFrom(json),
    ready,
    ...(!ready && typeof json?.waitingFor === 'string' ? { waitingFor: json.waitingFor } : {}),
    addedAt,
    checkedAt: (deps.now?.() ?? new Date()).toISOString(),
  }
}

/** Adds a domain and returns it with its records. */
export async function addSendingDomain(input: string, deps: SendingDomainDeps = {}): Promise<SendingDomain> {
  const domain = normalizeDomain(input)
  if (!domain) throw new Error('Enter a domain you own, like acme.com.')
  const existing = list().find((d) => d.domain === domain)
  if (existing?.records.length) return existing
  const added = await putOnHost(domain, (deps.now?.() ?? new Date()).toISOString(), deps)
  save(added)
  return added
}

/** Asks the host to check one domain's DNS again. */
export async function checkSendingDomain(domain: string, deps: SendingDomainDeps = {}): Promise<SendingDomain> {
  const d = list().find((x) => x.domain === domain)
  if (!d) throw new Error(`${domain} isn't one of your sending domains.`)
  const checked = await putOnHost(d.domain, d.addedAt, deps)
  save(checked)
  return checked
}

/** Stops sending from a domain, here and on the host. */
export async function removeSendingDomain(domain: string, deps: SendingDomainDeps = {}) {
  db.saveSendingDomains(list().filter((d) => d.domain !== domain))
  // Best effort: the host also stops once the domain's records are gone.
  await (deps.host ?? hostApi)('DELETE', domain).catch(() => null)
}

export const isReady = (d: SendingDomain) => d.ready

/** The address in "Name <jo@acme.com>" or "jo@acme.com". */
const addressOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase()

/** Whether mail may come from this address: its domain, or a parent of it, is ready. */
export function canSendFrom(from: string): boolean {
  const domain = addressOf(from).split('@')[1]
  if (!domain) return false
  return list().some((d) => isReady(d) && (domain === d.domain || domain.endsWith(`.${d.domain}`)))
}

/** Throws unless mail may come from this address (only when the host runs sending). */
export function requireSendingDomain(from: string) {
  if (!env.sendingManaged() || canSendFrom(from)) return
  const domain = addressOf(from).split('@')[1] ?? from
  throw new Error(`${domain} isn't a verified sending domain yet. Add it in Settings → Sending and put its DNS records in place.`)
}
