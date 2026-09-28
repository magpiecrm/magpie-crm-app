// Company email formats shared between hosted copies, under the DPA (2.4)
// and privacy policy: this copy reports, for each company, which formats the
// addresses it already holds there follow and how many (never names or
// addresses), and asks for other workspaces' counts when finding an address.
//
//   POST {REACHER_URL}/v1/formats  (x-reacher-secret)
//     { report: [{ domain, counts: { "{f}{last}": 3 } }] }   every 6 hours
//     { ask: [{ domain, headcount }] }  →  { answers: [{ domain, counts | null }] }
//
// The host answers only for companies of 10 or more people backed by three
// addresses from two other workspaces; here, only companies with a known
// headcount are asked about. Only in a hosted copy that hasn't been left out
// (hostRules.ts). Answers are company data, kept in memory for a day.

import { env } from '../env'
import { formatSharingOn } from './hostRules'
import type { KnownAddress } from './patternEvidence'
import { inferPattern } from './patterns'

const TIMEOUT_MS = 3_000
const REPORT_CHUNK = 500
const ANSWER_TTL_MS = 24 * 60 * 60_000
const MIN_HEADCOUNT = 10

/** Personal mailbox providers: an address there says nothing about a company. */
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.co.uk', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'qq.com', '163.com',
  'btinternet.com', 'sky.com', 'virginmedia.com', 'talktalk.net', 'orange.fr', 'free.fr', 'laposte.net', 'libero.it',
  't-online.de', 'hey.com', 'fastmail.com',
])

type Counts = Record<string, number>

const g = globalThis as { __sharedFormats?: Map<string, { counts: Counts | null; at: number }> }
const answers = (g.__sharedFormats ??= new Map())

function host(): { url: string; secret: string } | null {
  const url = env.reacher.url()
  const secret = env.reacher.secret()
  return formatSharingOn() && url && secret ? { url, secret } : null
}

async function call(body: unknown, fetchImpl: typeof fetch): Promise<any | null> {
  const h = host()
  if (!h) return null
  try {
    const res = await fetchImpl(`${h.url}/v1/formats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-reacher-secret': h.secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/**
 * Per company domain, how many real addresses (known or engaged, as in
 * patternEvidence.ts) follow each format. Bounced guesses, addresses that
 * match no format and personal mailbox domains are left out.
 */
export function formatCounts(addresses: KnownAddress[]): Map<string, Counts> {
  const byDomain = new Map<string, Counts>()
  const seen = new Set<string>()
  for (const a of addresses) {
    if (a.kind === 'bounced') continue
    const email = a.email.toLowerCase()
    const domain = email.split('@')[1]
    if (!domain || FREE_MAIL.has(domain) || seen.has(email)) continue
    seen.add(email)
    const pattern = inferPattern(email, a.firstName, a.lastName)
    if (!pattern) continue
    const counts = byDomain.get(domain) ?? {}
    counts[pattern] = (counts[pattern] ?? 0) + 1
    byDomain.set(domain, counts)
  }
  return byDomain
}

/** Reports this copy's counts to the host; how many companies it sent. */
export async function reportFormats(addresses: KnownAddress[], fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!host()) return 0
  const report = [...formatCounts(addresses)].map(([domain, counts]) => ({ domain, counts }))
  let sent = 0
  for (let i = 0; i < report.length; i += REPORT_CHUNK) {
    const chunk = report.slice(i, i + REPORT_CHUNK)
    if (!(await call({ report: chunk }, fetchImpl))) break
    sent += chunk.length
  }
  return sent
}

/** Other workspaces' counts for a company's formats, or null (unknown, too few, small company, or not shared). */
export async function sharedFormat(domain: string, headcount: number | null | undefined, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Counts | null> {
  if (!headcount || headcount < MIN_HEADCOUNT || !host()) return null
  const d = domain.toLowerCase()
  const cached = answers.get(d)
  if (cached && now - cached.at < ANSWER_TTL_MS) return cached.counts
  const body = await call({ ask: [{ domain: d, headcount }] }, fetchImpl)
  if (!body) return null
  const counts: Counts | null = body?.answers?.[0]?.counts ?? null
  answers.set(d, { counts, at: now })
  return counts
}

/** A cached answer only, for search (no request). */
export function cachedSharedFormat(domain: string, now = Date.now()): Counts | null {
  const cached = answers.get(domain.toLowerCase())
  return cached && now - cached.at < ANSWER_TTL_MS ? cached.counts : null
}
