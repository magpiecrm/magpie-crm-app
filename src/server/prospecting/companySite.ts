// Finds a company's website by web search, for an employer that has no
// LinkedIn page to read one from: mostly small firms whose founder typed the
// name in. A result is taken only when its domain plainly belongs to the
// name ("Tinderbox Research" -> tinderboxresearch.com), and never a
// directory, a social network or a registry. The email check is the second
// safeguard: an address only counts once that domain's mail server confirms
// it.
//
// What was found, or that nothing was, is remembered by the company's name
// (db company_sites) so the same employer isn't searched for again: a
// website for six months, nothing found for one. Company data only.

import { companyKey, domainFromWebsite } from './socialfetch'
import type { WebResult, WebSearch } from './webSearch'

type Db = typeof import('../db')['db']

const DAY = 24 * 60 * 60_000
const FOUND_KEPT_MS = 180 * DAY
const NOT_FOUND_KEPT_MS = 30 * DAY

/** Sites that list companies rather than being one. Matched as a suffix. */
const NOT_THEIR_SITE = [
  'linkedin.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'youtube.com', 'tiktok.com', 'pinterest.com', 'medium.com',
  'wikipedia.org', 'gov.uk', 'service.gov.uk', 'companieshouse.gov.uk', 'endole.co.uk', 'opencorporates.com', 'companycheck.co.uk', 'dnb.com',
  'crunchbase.com', 'pitchbook.com', 'cbinsights.com', 'zoominfo.com', 'apollo.io', 'rocketreach.co', 'signalhire.com', 'lusha.com',
  'glassdoor.com', 'glassdoor.co.uk', 'indeed.com', 'yell.com', 'yelp.com', 'trustpilot.com', 'bloomberg.com', 'reuters.com', 'ft.com',
  'google.com', 'apple.com', 'amazon.com', 'amazon.co.uk', 'bing.com', 'github.com', 'clutch.co', 'g2.com', 'capterra.com', 'theorg.com',
  'find-and-update.company-information.service.gov.uk', 'bizdb.co.uk', '192.com', 'cylex-uk.co.uk', 'thomsonlocal.com', 'scoot.co.uk',
]

/** Words on the end of a company's name that its domain often leaves off. */
const TRAILING = new Set(['uk', 'international', 'global', 'group', 'consulting', 'consultancy', 'consultants', 'research', 'solutions', 'services', 'partners', 'associates', 'agency', 'studio', 'media', 'digital', 'marketing', 'insight', 'insights'])
/** And what a domain often adds. */
const ADDED = ['', 'uk', 'ltd', 'group', 'hq', 'global', 'online', 'co']
const TWO_LEVEL_TLD = /\.(co|org|ac|ltd|plc|net|com|gov)\.[a-z]{2}$/

/** The name part of a domain, letters and digits only: "nelson-hall.com" -> "nelsonhall". */
function labelOf(domain: string): string {
  const labels = domain.replace(TWO_LEVEL_TLD, '').split('.')
  const name = TWO_LEVEL_TLD.test(domain) ? labels[labels.length - 1] : labels[labels.length - 2]
  return (name ?? '').replace(/[^a-z0-9]/g, '')
}

/** Whether a domain is plainly this company's: its name run together, give or take a common ending. */
export function domainFitsName(domain: string, name: string): boolean {
  const label = labelOf(domain)
  if (label.length < 3) return false
  // "Smith & Jones" is smithjones or smithandjones.
  return [name, name.replace(/&/g, ' and ')].some((spelt) => {
    const words = companyKey(spelt).split(' ').filter(Boolean)
    if (!words.length) return false
    const whole = words.join('')
    const core = [...words]
    while (core.length > 1 && TRAILING.has(core[core.length - 1])) core.pop()
    const short = core.join('')
    return [whole, ...(short.length >= 4 ? [short] : [])].some((n) => ADDED.some((extra) => label === n + extra))
  })
}

/** The first result whose domain is plainly the company's own. */
export function siteFromResults(name: string, results: WebResult[]): string | null {
  for (const r of results) {
    const domain = domainFromWebsite(r.url)
    if (!domain || NOT_THEIR_SITE.some((s) => domain === s || domain.endsWith(`.${s}`))) continue
    if (domainFitsName(domain, name)) return domain
  }
  return null
}

// One search for several people at the same employer.
const inflight = new Map<string, Promise<string | null>>()

/**
 * A company's website domain from a web search for its name, or null. Asks
 * once per name and remembers the answer; a search that fails is tried
 * again next time.
 */
export async function findCompanySite(name: string, country: string | null, search: WebSearch, db: Pick<Db, 'getCompanySite' | 'setCompanySite'>, now = Date.now()): Promise<string | null> {
  const key = companyKey(name)
  if (key.length < 3) return null
  const kept = db.getCompanySite(key)
  if (kept && now - new Date(kept.at).getTime() < (kept.domain ? FOUND_KEPT_MS : NOT_FOUND_KEPT_MS)) return kept.domain
  const pending = inflight.get(key)
  if (pending) return pending
  const task = (async () => {
    let results: WebResult[]
    try {
      results = await search([`"${name.trim()}"`, country?.trim()].filter(Boolean).join(' '))
    } catch {
      return null
    }
    const domain = siteFromResults(name, results)
    db.setCompanySite(key, domain)
    // The domain only: a small firm's name can be a person's.
    console.log(`[CompanySite] web search ${domain ? `found ${domain}` : 'found no website that is plainly theirs'}`)
    return domain
  })()
  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}
