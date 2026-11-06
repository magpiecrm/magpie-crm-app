// DNS facts about a sending domain that mailbox providers check: whether it
// publishes SPF and DMARC records, and whether it (or a domain an email links
// to) is on the Spamhaus domain blocklist. Used by inbox warmup's checks and
// the spam score; each answer is kept for a while, since DNS changes slowly.

import { resolve4, resolveTxt } from 'node:dns/promises'
import { domainBlocklistCodes, domainBlocklistReachable } from './prospecting/senderHealth'

export interface DnsAuthDeps {
  resolveTxt?: (name: string) => Promise<string[][]>
  /** A records; `[]` when the name doesn't exist. */
  resolve4?: (name: string) => Promise<string[]>
  now?: () => Date
}

const AUTH_TTL_MS = 10 * 60_000
const DBL_TTL_MS = 24 * 60 * 60_000

/** Each domain's SPF and DMARC records, as last looked up (for 10 minutes). */
const authSeen = new Map<string, { at: number; spf: boolean; dmarc: boolean }>()

export async function authRecords(domain: string, deps: DnsAuthDeps = {}): Promise<{ spf: boolean; dmarc: boolean }> {
  const now = (deps.now?.() ?? new Date()).getTime()
  const seen = authSeen.get(domain)
  if (seen && now - seen.at < AUTH_TTL_MS) return seen
  const txt = async (name: string) => ((await (deps.resolveTxt ?? resolveTxt)(name).catch(() => [])) as string[][]).map((r) => r.join(''))
  const spf = (await txt(domain)).some((r) => /^v=spf1\b/i.test(r.trim()))
  // A subdomain without its own DMARC record falls under its organisation's.
  const labels = domain.split('.')
  let dmarc = false
  for (const name of [`_dmarc.${domain}`, ...(labels.length > 2 ? [`_dmarc.${labels.slice(-2).join('.')}`] : [])]) {
    if ((await txt(name)).some((r) => /^v=DMARC1\b/i.test(r.trim()))) {
      dmarc = true
      break
    }
  }
  const found = { at: now, spf, dmarc }
  authSeen.set(domain, found)
  return found
}

const empty = (err: any) => err?.code === 'ENOTFOUND' || err?.code === 'ENODATA'
const realResolve4 = (name: string) => resolve4(name).catch((err) => (empty(err) ? [] : Promise.reject(err)))

/** Whether each domain is on the Spamhaus DBL, as last looked up (for a day). */
const dblSeen = new Map<string, { at: number; listed: boolean }>()
let dblReachable: { at: number; ok: boolean } | null = null

/**
 * Which of these domains are on the Spamhaus domain blocklist. `checked` is
 * false when Spamhaus couldn't be asked (it refuses public DNS resolvers), so
 * "none listed" isn't mistaken for a clean bill.
 */
export async function dblListed(domains: string[], deps: DnsAuthDeps = {}): Promise<{ checked: boolean; listed: string[] }> {
  const now = (deps.now?.() ?? new Date()).getTime()
  const dns = { resolve4: deps.resolve4 ?? realResolve4 }
  if (!dblReachable || now - dblReachable.at > AUTH_TTL_MS) dblReachable = { at: now, ok: await domainBlocklistReachable(dns) }
  if (!dblReachable.ok) return { checked: false, listed: [] }
  const listed: string[] = []
  for (const domain of [...new Set(domains.map((d) => d.toLowerCase()))]) {
    let seen = dblSeen.get(domain)
    if (!seen || now - seen.at > DBL_TTL_MS) {
      const codes = await domainBlocklistCodes(domain, dns)
      // Couldn't be asked this time: don't remember it.
      if (codes === null) continue
      seen = { at: now, listed: codes.length > 0 }
      dblSeen.set(domain, seen)
    }
    if (seen.listed) listed.push(domain)
  }
  return { checked: true, listed }
}
