// Finds a company's website by web search, for an employer that has no
// LinkedIn page to read one from: mostly small firms whose founder typed the
// name in. A result is taken only when its domain plainly belongs to the
// name ("Tinderbox Research" -> tinderboxresearch.com), and never a
// directory, a social network or a registry. A domain that is only the first
// part of the name ("Acme Consulting" -> acme.co.uk) counts when the page
// names the company in full. The email check is the second safeguard: an
// address only counts once that domain's mail server confirms it.
//
// The search is for the name alone, from the company's own country: a small
// firm's site comes first there, and adding the country as a word, or "Ltd",
// brings up registries and directories instead.
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
const ADDED = ['uk', 'ltd', 'group', 'hq', 'global', 'online', 'co']
/** Or puts in front: "Frozen Garden" -> thefrozengarden.com. */
const PREFIXED = ['the', 'weare', 'get', 'hello', 'team', 'try', 'go', 'my']
const TWO_LEVEL_TLD = /\.(co|org|ac|ltd|plc|net|com|gov)\.[a-z]{2}$/
const LEGAL_FORM = /[\s,.]+(ltd|limited|llp|llc|plc|inc|incorporated|corp|corporation|gmbh|kg|ag|bv|pty|srl)\.?$/i

const squash = (s: string) => s.replace(/[^a-z0-9]/g, '')

/**
 * The company's name by itself: without an aside in brackets, a strapline
 * ("onefoursix - Digital Marketing Agency") or its legal form, which bring
 * up registries and directories when searched for.
 */
export function plainName(name: string): string {
  let plain = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  const strapline = plain.search(/\s[-–—|:]\s|\s?\|\s?/)
  if (strapline >= 3) plain = plain.slice(0, strapline)
  for (let i = 0; i < 3; i++) plain = plain.replace(/[\s,.&]+co\.?$/i, '').replace(LEGAL_FORM, '').trim()
  return plain.length >= 3 ? plain : name.trim()
}

/** The domain a company would have email on: "reimagine.nelson-hall.com" -> "nelson-hall.com". */
function siteDomain(host: string): string {
  return host.split('.').slice(TWO_LEVEL_TLD.test(host) ? -3 : -2).join('.')
}

/** The name part of a domain, letters and digits only: "nelson-hall.com" -> "nelsonhall". */
function labelOf(host: string): string {
  return squash(siteDomain(host).split('.')[0] ?? '')
}

const EXACT = 3
const WITH_ENDING = 2
/** Close, but other companies could have it: only taken when the page names the company. */
const LOOSE = 1

/**
 * How well a domain fits a company's name: exactly the name run together
 * ("Nelson Hall" -> nelson-hall.com), the name with a common ending
 * (acmeuk.com), or loosely: the name without its last word or two ("Acme
 * Consulting" -> acme.co.uk), with those as initials (finelinemr.co.uk),
 * with something in front (getacme.com), or without its "The".
 */
function fit(host: string, name: string): number {
  const label = labelOf(host)
  const plain = plainName(name)
  const the = /^the\s/i.test(plain) ? 'the' : ''
  let best = 0
  // "Smith & Jones" is smithjones or smithandjones.
  for (const spelt of [plain, plain.replace(/[&+]/g, ' and ')]) {
    const words = companyKey(spelt).split(' ').filter(Boolean)
    const whole = the + words.join('')
    // Too short to be anyone's in particular.
    if (whole.length < 4) continue
    // The name spread over the ending too: "Research Works" -> research.works.
    if (label === whole || (!TWO_LEVEL_TLD.test(host) && squash(siteDomain(host)) === whole)) return EXACT
    if (ADDED.some((extra) => label === whole + extra)) best = Math.max(best, WITH_ENDING)
    const core = [...words]
    while (core.length > 1 && TRAILING.has(core[core.length - 1])) core.pop()
    const short = the + core.join('')
    if (short !== whole && short.length >= 4 && ['', ...ADDED].some((extra) => label === short + extra)) best = Math.max(best, LOOSE)
    if (!the && PREFIXED.some((front) => label === front + whole)) best = Math.max(best, LOOSE)
    if (the && ['', ...ADDED].some((extra) => label === words.join('') + extra)) best = Math.max(best, LOOSE)
    if (words.length > 1 && words[0].length >= 4 && label === the + words[0] + words.slice(1).map((w) => w[0]).join('')) best = Math.max(best, LOOSE)
  }
  return best
}

/** Whether a domain could be this company's, going by its name alone. */
export function domainFitsName(domain: string, name: string): boolean {
  return fit(domain, name) > 0
}

/**
 * Whether a result's own words name the company in full, however it's
 * spaced: "NelsonHall | Analyst research". A name that starts with "The" has
 * to be there with it: "The Joy Club" isn't JOYclub.
 */
function namesCompany(r: WebResult, name: string): boolean {
  const plain = plainName(name)
  const whole = squash(companyKey(plain))
  if (whole.length < 4) return false
  const text = `${r.title} ${r.description}`
  return /^the\s/i.test(plain) ? squash(text.toLowerCase()).includes(`the${whole}`) : squash(companyKey(text)).includes(whole)
}

/**
 * The result whose domain is plainly the company's own: the closest fit to
 * its name, and the first of those. A loose fit needs the page to name the
 * company too, so that "Tinderbox Research" isn't given another Tinderbox's
 * site. A one-word name is shared by more companies than any other, so its
 * site has to be one of the first two results.
 */
export function siteFromResults(name: string, results: WebResult[]): string | null {
  const oneWord = !companyKey(plainName(name)).includes(' ')
  let found: { domain: string; fit: number } | null = null
  for (const r of oneWord ? results.slice(0, 2) : results) {
    const host = domainFromWebsite(r.url)
    if (!host || NOT_THEIR_SITE.some((s) => host === s || host.endsWith(`.${s}`))) continue
    const how = fit(host, name)
    if (how > (found?.fit ?? 0) && (how > LOOSE || namesCompany(r, name))) found = { domain: siteDomain(host), fit: how }
  }
  return found?.domain ?? null
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
      results = await search(plainName(name), country)
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
