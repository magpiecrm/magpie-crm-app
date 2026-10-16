// Hiring and funding signals from a web search (signals.ts): one search per
// company and signal, read here into a badge or nothing. The host runs these
// for hosted copies and shares what it finds between them (company data);
// a copy with its own WEB_SEARCH_API_KEY runs them itself (companySignals.ts).
//
// Precision matters more than recall: a wrong "Hiring" or "Raised £5M" badge
// sends someone an email about something that didn't happen. So a result
// counts only when it's plainly about this company (its own site, its page
// on a job board or applicant-tracking system, or its name in full beside
// the news) and recent, and never from LinkedIn.
//
// Queries carry only the company's name, in quotes. "OR" and brackets are
// avoided: through the search API they turned "Acme careers" into a search
// for careers in general (checked 2026-10-16).

import { domainFitsName, plainName } from './companySite'
import { companyKey, domainFromWebsite } from './socialfetch'
import { isLineOfWork } from './companies'
import type { Signal } from './types'
import type { WebResult } from './webSearch'

export interface SignalCompany {
  name: string
  domain?: string | null
  country?: string | null
}

const DAY = 86_400_000
/** A job listed longer ago than this has probably been filled. */
const HIRING_MAX_AGE_DAYS = 90
const FUNDING_MAX_AGE_DAYS = 365
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const TWO_LEVEL_TLD = /\.(co|org|ac|ltd|plc|net|com|gov)\.[a-z]{2}$/
const siteDomain = (host: string) => host.split('.').slice(TWO_LEVEL_TLD.test(host) ? -3 : -2).join('.')
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}
const fromLinkedIn = (host: string) => host === 'linkedin.com' || host.endsWith('.linkedin.com')

/** The company's name run together, for matching a page name or a slug: "Acme Widgets Ltd" -> "acmewidgets". */
const nameKey = (c: SignalCompany) => squash(companyKey(plainName(c.name)))

/**
 * A name other companies share or that's just a word: one word, short, or a
 * word for a line of work ("Clean", "Vertex"). Only the strongest evidence
 * counts for these.
 */
/** Words a company's name adds that say nothing of which company: "Digital Marketing Agency". */
const GENERIC = new Set(['agency', 'global', 'international', 'solutions', 'studio', 'studios', 'partners', 'associates', 'network', 'collective', 'company', 'firm', 'hub', 'uk', 'usa', 'us', 'europe', 'world', 'national', 'local', 'and'])

export function isAmbiguous(c: SignalCompany): boolean {
  const words = companyKey(plainName(c.name)).split(' ').filter(Boolean)
  if (!words.length) return true
  if (words.every((w) => isLineOfWork(w) || GENERIC.has(w))) return true
  return words.length === 1 && (words[0].length < 6 || /^[a-z]+$/.test(words[0]) === false)
}

/** Whether the result's words name the company in full, however it's spaced. */
function names(r: WebResult, c: SignalCompany): boolean {
  const whole = nameKey(c)
  return whole.length >= 4 && squash(companyKey(`${r.title} ${r.description}`)).includes(whole)
}

/**
 * When a result says it's from, from Google's date in front of the snippet:
 * "24 Nov 2025 — …", "Nov 24, 2025 — …", "8 days ago — …". Null when it doesn't say.
 */
export function resultDate(r: WebResult, now: Date): Date | null {
  const text = r.description.slice(0, 40).toLowerCase()
  const ago = text.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago\b/)
  if (ago) {
    const n = Number(ago[1])
    const unit = { minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 }[ago[2] as 'day']
    return new Date(now.getTime() - n * unit * DAY)
  }
  const dmy = text.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})\b/)
  const mdy = text.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/)
  const [day, mon, year] = dmy ? [dmy[1], dmy[2], dmy[3]] : mdy ? [mdy[2], mdy[1], mdy[3]] : []
  const month = mon ? MONTHS.indexOf(mon) : -1
  if (month < 0) return null
  return new Date(Date.UTC(Number(year), month, Number(day)))
}

const tooOld = (r: WebResult, now: Date, days: number) => {
  const at = resultDate(r, now)
  return at !== null && now.getTime() - at.getTime() > days * DAY
}

/* ------------------------------------------------------------------ hiring */

/** The search: the company's name in quotes with the words its careers page and job listings use. */
export const hiringQuery = (c: SignalCompany) => `"${plainName(c.name)}" careers jobs`

/**
 * Applicant-tracking systems: a company's jobs live at a path or subdomain
 * named after it. Either kind is read the same way: `slug` gives the part
 * that names the company.
 */
const ATS: Array<{ host: RegExp; slug: (u: URL) => string | undefined }> = [
  { host: /(^|\.)greenhouse\.io$/, slug: (u) => u.pathname.split('/')[1] },
  { host: /^jobs\.lever\.co$/, slug: (u) => u.pathname.split('/')[1] },
  { host: /^jobs\.ashbyhq\.com$/, slug: (u) => u.pathname.split('/')[1] },
  { host: /^apply\.workable\.com$/, slug: (u) => u.pathname.split('/')[1] },
  { host: /^jobs\.smartrecruiters\.com$/, slug: (u) => u.pathname.split('/')[1] },
  { host: /\.teamtailor\.com$/, slug: (u) => u.hostname.split('.')[0] },
  { host: /\.bamboohr\.com$/, slug: (u) => u.hostname.split('.')[0] },
  { host: /\.recruitee\.com$/, slug: (u) => u.hostname.split('.')[0] },
  { host: /\.breezy\.hr$/, slug: (u) => u.hostname.split('.')[0] },
  { host: /\.pinpointhq\.com$/, slug: (u) => u.hostname.split('.')[0] },
  { host: /\.applytojob\.com$/, slug: (u) => u.hostname.split('.')[0] },
  { host: /\.jobs\.personio\.(de|com)$/, slug: (u) => u.hostname.split('.')[0] },
  { host: /\.myworkdayjobs\.com$/, slug: (u) => u.hostname.split('.')[0] },
  { host: /^careers\.hibob\.com$/, slug: (u) => u.pathname.split('/')[1] },
  { host: /^ats\.rippling\.com$/, slug: (u) => u.pathname.split('/')[1] },
]

/** Job boards: a company's own page there counts when it gives a number of jobs above nought. */
const JOB_BOARDS = /(^|\.)(indeed\.com|glassdoor\.(com|co\.uk)|reed\.co\.uk|totaljobs\.com|cv-library\.co\.uk|welcometothejungle\.com|otta\.com|wellfound\.com|builtin\.com|ziprecruiter\.com|simplyhired\.com|monster\.(com|co\.uk)|jobs\.ashbyhq\.com|workable\.com)$/

/** Words saying there's nothing open. */
const NOTHING_OPEN = /\b(no (current |open )?(vacancies|openings|positions|roles|jobs)|not (currently )?hiring|no jobs? (found|available)|check back (later|soon)|there are (currently )?no)\b/i
/** Words a careers page uses when there is something open. */
const SOMETHING_OPEN = /\b(we'?re hiring|we are hiring|is hiring|are hiring|now hiring|(we'?re|is|now) recruiting|open (positions|roles|jobs|vacancies)|current (vacancies|openings)|job openings|join our team|apply now)\b/i
/** One job's own page on a board: "Engineers Assistant - Tomtech (UK) Ltd". */
const JOB_LISTING = /(^|\.)(glassdoor\.(com|co\.uk)\/job-listing\/|indeed\.com\/viewjob|reed\.co\.uk\/jobs\/|totaljobs\.com\/job\/|cv-library\.co\.uk\/job\/)/
const JOB_COUNT = /\b(\d[\d,]*)\s+(?:open\s+|current\s+|new\s+)?(?:jobs?|vacanc(?:y|ies)|positions?|roles?|openings?)\b/i

/** "Open Positions (6)", as applicant-tracking pages put it. */
const JOB_COUNT_IN_BRACKETS = /\b(?:open\s+)?(?:positions|roles|jobs|openings|vacancies)\s*\((\d+)\)/i

const jobCount = (text: string): number | null => {
  const m = text.match(JOB_COUNT_IN_BRACKETS) ?? text.match(JOB_COUNT)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** The company's own site: its domain, or a careers or jobs subdomain of it. */
const ownSite = (host: string, c: SignalCompany) => Boolean(c.domain && siteDomain(host) === siteDomain(c.domain.toLowerCase().replace(/^www\./, '')))

/**
 * "Hiring", from a search's results, or null. Strong evidence: the company's
 * page on an applicant-tracking system, or its own careers page saying jobs
 * are open. Medium: its own page on a job board, with a number of jobs above
 * nought, for a name nobody else has. Never LinkedIn; nothing older than
 * HIRING_MAX_AGE_DAYS; nothing saying there are no vacancies.
 */
export function parseHiring(c: SignalCompany, results: WebResult[], now = new Date()): Signal | null {
  const key = nameKey(c)
  if (key.length < 3) return null
  const label = c.domain ? squash(siteDomain(c.domain).split('.')[0] ?? '') : ''
  const ambiguous = isAmbiguous(c)
  type Evidence = { strength: number; count: number | null; url: string; where: string }
  const seen: Evidence[] = []
  const consider = (strength: number, count: number | null, url: string, where: string) => void seen.push({ strength, count, url, where })

  for (const r of results) {
    const host = hostOf(r.url)
    if (!host || fromLinkedIn(host)) continue
    const text = `${r.title} ${r.description}`
    // Nothing open, said in words or as a nought ("Open Positions (0)").
    if (NOTHING_OPEN.test(text) || jobCount(text) === 0 || tooOld(r, now, HIRING_MAX_AGE_DAYS)) continue
    let url: URL
    try {
      url = new URL(r.url)
    } catch {
      continue
    }
    const ats = ATS.find((a) => a.host.test(url.hostname.toLowerCase()))
    if (ats) {
      // Named after the company: its domain's name, or its own name where the domain says the same
      // (getacme.com, acmehq.com). "bubble" isn't hellobubble.com's: another Bubble has that page.
      const slug = squash(ats.slug(url) ?? '')
      const isTheirs = slug && (label ? slug === label || (slug === key && label.includes(key) && label.length - key.length <= 3) : slug === key)
      if (isTheirs) consider(3, jobCount(text), r.url, url.hostname)
      continue
    }
    if (ownSite(host, c)) {
      const careers = /career|jobs?\b|vacanc|join-?us|work-?with-?us|hiring/i.test(`${url.pathname} ${url.hostname} ${r.title}`)
      const count = jobCount(text)
      if (careers && ((count ?? 0) > 0 || SOMETHING_OPEN.test(text))) consider(3, count, r.url, 'their careers page')
      continue
    }
    // A job board's page is only as sure as the name: not for a shared one, nor where the company's
    // own domain doesn't fit its name (the record may be another company's of that name).
    if (JOB_BOARDS.test(host) && !ambiguous && names(r, c) && (!c.domain || domainFitsName(c.domain, c.name))) {
      // "57 jobs at Acme", "Acme Jobs and Careers - 12 open jobs".
      const count = jobCount(text)
      if ((count ?? 0) > 0) consider(2, count, r.url, host)
      // One job's own listing, its title naming the company after the role.
      else if (JOB_LISTING.test(`${host}${url.pathname}`) && names({ ...r, description: '' }, c)) consider(1, null, r.url, host)
    }
  }
  // The strongest evidence, and of that the biggest count.
  const found = seen.sort((a, b) => b.strength - a.strength || (b.count ?? 0) - (a.count ?? 0))[0]
  if (!found) return null
  return {
    kind: 'hiring',
    label: found.count ? `Hiring · ${found.count.toLocaleString('en-GB')} open ${found.count === 1 ? 'role' : 'roles'}` : 'Hiring',
    detail: `Jobs listed on ${found.where}.`,
    at: now.toISOString().slice(0, 10),
    url: found.url,
    source: 'web',
  }
}

/* ----------------------------------------------------------------- funding */

/** The search: the company's name in quotes, and the words news of a round uses. Asked for the past year only. */
export const fundingQuery = (c: SignalCompany) => `"${plainName(c.name)}" funding round`

/**
 * Sites whose page about a company is a standing profile: its date is the
 * page's, and what it says is the total raised over the years. Never counted.
 */
const PROFILE_SITES = /(^|\.)(crunchbase\.com|tracxn\.com|dealroom\.co|clay\.com|pitchbook\.com|cbinsights\.com|craft\.co|owler\.com|zoominfo\.com|growjo\.com|wellfound\.com|f6s\.com|beauhurst\.com|startupintros\.com|getlatka\.com|privco\.com|leadiq\.com|rocketreach\.co|cbinsights\.com|signal\.nfx\.com)$/
/** A profile's words: a total over the years, not a round. */
const LIFETIME = /\b(in total|a total (of|funding)|total funding|raised a total|across \d+ (funding )?rounds|over \d+ (funding )?rounds|funded by|investors include|who invested|when was the last|how much did|(previously|had|have|has so far) raised|raised to date|to date|so far)\b/i
/** News publishers: their result counts when the raise is in its words, not only in its headline. */
const NEWS = /(^|\.)(techcrunch\.com|sifted\.eu|uktech\.news|uktn\.co\.uk|eu-startups\.com|finsmes\.com|businesswire\.com|prnewswire\.com|prnewswire\.co\.uk|globenewswire\.com|tech\.eu|news\.crunchbase\.com|venturebeat\.com|reuters\.com|bloomberg\.com|ft\.com|cnbc\.com|businessinsider\.com|axios\.com|siliconangle\.com|finextra\.com|fintechfutures\.com|cityam\.com|businesscloud\.co\.uk|insidermedia\.com|thesaasnews\.com|vcnewsdaily\.com|startups\.co\.uk|maddyness\.com|growthbusiness\.co\.uk|prweb\.com|accessnewswire\.com)$/

const AMOUNT = /(?:£|\$|€|us\$|usd\s?|gbp\s?|eur\s?)\s?(\d+(?:[.,]\d+)?)\s?(k|m|mn|million|bn|b|billion)?\b|\b(\d+(?:\.\d+)?)\s?(million|billion|mn|bn)\s?(?:pounds|dollars|euros)?\b/i
const ROUND = /\b(pre-seed|seed|series [a-h]|growth round|bridge round)\b/i
/** Words for raising money, and the weaker ones that only mean it with a round named ("closes its seed round"). */
const RAISED = /\b(raises?|raised|raising|secures?|secured|lands?|landed|bags?|bagged|nabs?|nabbed)\b/i
const RAISED_WITH_ROUND = /\b(closes?|closed|announces?|announced|completes?|completed|gets?|picks? up|receives?|received)\b/i
const ROUND_WORDS = /\b(funding|round|investment|pre-seed|seed|series [a-h]|backing)\b/i
/** "Raises prices", "plans to raise": not a round. */
const NOT_A_ROUND = /\b(raises? (prices?|rates?|awareness|concerns?|questions?|the bar|money for charity)|(plans?|looking|seeks?|seeking|aims?|hopes?) to raise|in talks to raise)\b/i

/** How a round is said: "£5M Series A", "$12 million", "seed round". */
function describeRound(text: string): string | null {
  const amount = text.match(AMOUNT)
  const round = text.match(ROUND)?.[1]
  const money = amount
    ? (() => {
        const raw = amount[0].trim()
        const unit = (amount[2] ?? amount[4] ?? '').toLowerCase()
        const symbol = /£|gbp/i.test(raw) ? '£' : /€|eur/i.test(raw) ? '€' : '$'
        const n = amount[1] ?? amount[3]
        const short = /^(m|mn|million)$/.test(unit) ? 'M' : /^(b|bn|billion)$/.test(unit) ? 'B' : /^k$/.test(unit) ? 'K' : ''
        return short || Number(n) >= 1000 ? `${symbol}${n}${short}` : null
      })()
    : null
  const roundName = round ? round.replace(/\bseries\b/i, 'Series').replace(/^seed$/i, 'seed round').replace(/^pre-seed$/i, 'pre-seed round') : null
  return [money, roundName].filter(Boolean).join(' ') || null
}

/**
 * "Raised £5M Series A · Mar 2026", from a search's results, or null. A
 * result counts when it names the company in full, says it raised (a verb
 * and an amount or a round, near the name), isn't about it investing, and is
 * dated within the year; an undated one only from a news site. An ambiguous
 * name also needs its domain on the page or in the address.
 */
export function parseFunding(c: SignalCompany, results: WebResult[], now = new Date()): Signal | null {
  const whole = nameKey(c)
  if (whole.length < 4) return null
  const plain = plainName(c.name)
  const escaped = plain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const investing = new RegExp(`\\b${escaped}\\s+(invests?|invested|led|leads|backs|backed|participated|joins)\\b|\\b${escaped}\\s+(ventures|capital|vc)\\b`, 'i')
  const ambiguous = isAmbiguous(c)
  for (const r of results) {
    const host = hostOf(r.url)
    if (!host || fromLinkedIn(host)) continue
    const text = `${r.title}. ${r.description}`
    if (PROFILE_SITES.test(host) || !names(r, c) || NOT_A_ROUND.test(text) || LIFETIME.test(text) || (investing.test(text) && !/ventures|capital/i.test(plain))) continue
    if (ambiguous && !(c.domain && (host.endsWith(siteDomain(c.domain)) || text.toLowerCase().includes(siteDomain(c.domain))))) continue
    // The company is the one raising: its name, then within 60 characters a word for raising,
    // then an amount or a round ("Acme raises $5M", "Acme, the payments firm, has closed its seed round").
    const subject = new RegExp(`\\b${escaped}(?:['’]s)?[^.!?]{0,60}?\\b(?:${RAISED.source.slice(2, -2)}|${RAISED_WITH_ROUND.source.slice(2, -2)})\\b`, 'i')
    // A headline saying so; on a news site, its first words too. Anywhere else, a mention in passing
    // is as often an old round or someone else's as this company's news.
    const where = NEWS.test(host) ? text : `${r.title}.`
    const sentence = where.split(/(?<=[.!?])\s+/).find((s) => {
      const m = s.match(subject)
      if (!m) return false
      const after = s.slice(m.index! + m[0].length - 1, m.index! + m[0].length + 70)
      return RAISED.test(m[0]) ? AMOUNT.test(after) || ROUND_WORDS.test(after) : ROUND_WORDS.test(after)
    })
    if (!sentence) continue
    const date = resultDate(r, now)
    if (date && now.getTime() - date.getTime() > FUNDING_MAX_AGE_DAYS * DAY) continue
    if (!date && !NEWS.test(host)) continue
    // A raise the headline gives, dated by the snippet: the round is in the headline's sentence.
    const round = describeRound(sentence)
    const when = date ? `${MONTH_LABEL[date.getUTCMonth()]} ${date.getUTCFullYear()}` : null
    return {
      kind: 'funding',
      label: [round ? `Raised ${round}` : 'Raised funding', when].filter(Boolean).join(' · '),
      detail: `Reported on ${host}.`,
      at: date ? date.toISOString().slice(0, 10) : null,
      url: r.url,
      source: 'web',
    }
  }
  return null
}

/** For tests and the accuracy check: the host part of a result, as matched. */
export const resultHost = (r: WebResult) => domainFromWebsite(r.url) ?? hostOf(r.url)
