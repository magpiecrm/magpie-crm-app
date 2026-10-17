// Reading people out of a search engine's results for public LinkedIn
// profiles (webSource.ts), and writing the queries that find them.
//
// What a result carries, checked on Decodo's Google results (2026-10-17):
// a title, mostly "Name - Title at Company | LinkedIn" or "Name - Company |
// LinkedIn" (the older "Name - Title - Company" is rare now); for about half
// of profiles, `info` [location, job title, employer]; and a snippet that
// sometimes says "Experience: Company · Location: City". Between them the
// employer is there for about four in five people.
//
// Data minimisation as in socialfetch.ts mapPerson: only the name, job
// title, employer and country are read, never the rest of the snippet.

import { canonicalProfileUrl } from './socialfetch'
import { canonicalCountry } from './geo'
import type { WebResult } from './webSearch'

export interface ListedPerson {
  profileUrl: string
  firstName: string
  lastName: string
  /** The texts that may name their job, best first: the job title fact, then the result's title after the name. */
  jobTexts: string[]
  /** The job title as the result gives it, before it's matched to the titles searched. */
  title: string
  /** Their employer as the result gives it; '' when it doesn't say, or only in part. */
  company: string
  /** Their country, when the result says (the location fact, the profile's country site, the snippet). */
  country: string | null
}

/** LinkedIn's country sites (uk.linkedin.com) and the country each is. */
const COUNTRY_SITES: Record<string, string> = {
  uk: 'United Kingdom', ie: 'Ireland', de: 'Germany', fr: 'France', nl: 'Netherlands', be: 'Belgium', es: 'Spain', it: 'Italy',
  pt: 'Portugal', ch: 'Switzerland', at: 'Austria', se: 'Sweden', dk: 'Denmark', no: 'Norway', fi: 'Finland', pl: 'Poland',
  ca: 'Canada', au: 'Australia', nz: 'New Zealand', in: 'India', sg: 'Singapore', ae: 'United Arab Emirates', za: 'South Africa',
  br: 'Brazil', mx: 'Mexico',
}

/** The country site for a country, or null for one searched on www (the United States, and those without one). */
export function countrySite(country: string | null | undefined): string | null {
  const c = canonicalCountry(country)
  if (!c) return null
  return Object.entries(COUNTRY_SITES).find(([, name]) => canonicalCountry(name) === c)?.[0] ?? null
}

const UK_NATIONS = /^(england|scotland|wales|northern ireland)$/i

/** "Leeds, England, United Kingdom" -> "United Kingdom"; a city alone says nothing. */
function countryIn(location: string | undefined): string | null {
  if (!location) return null
  const parts = location.split(',').map((s) => s.trim().replace(/\s+(metropolitan )?area$/i, '').replace(/^greater\s+/i, ''))
  for (let i = parts.length - 1; i >= 0; i--) {
    if (UK_NATIONS.test(parts[i])) return canonicalCountry('United Kingdom')
    const c = canonicalCountry(parts[i])
    if (c) return c
  }
  return null
}

const truncated = (s: string) => /(\.\.\.|…)\s*$/.test(s)
const tidy = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** "Jane Smith, MBA" / "Dr. Jane Smith (she/her)" -> ["Jane", "Smith"]; null when it isn't a name. */
function nameFrom(text: string): [string, string] | null {
  const name = text
    .replace(/\(.*?\)/g, ' ')
    .split(/[,|]/)[0]
    .replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '')
    .replace(/[^\p{L}\p{M}'’. -]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = name.split(' ').filter(Boolean)
  if (!words.length || words.length > 5) return null
  return [words[0], words.slice(1).join(' ')]
}

/** "Head of Sales at Acme" -> ["Head of Sales", "Acme"]. */
function splitAt(text: string): [string, string] | null {
  const m = text.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i)
  return m ? [tidy(m[1]), tidy(m[2])] : null
}

/**
 * One search result, if it's a person's LinkedIn profile: their name, the
 * texts naming their job, their employer and country. `isTitle` says whether
 * a text is a job title (the titles searched, or any job), so that in "Name -
 * X" an X that isn't one is taken for the employer.
 */
export function readListing(r: WebResult, isTitle: (text: string) => boolean): ListedPerson | null {
  const profileUrl = canonicalProfileUrl(r.url)
  if (!profileUrl) return null
  const head = r.title.replace(/\s*[|\-–—]\s*LinkedIn\b.*$/i, '')
  const parts = head.split(/\s+[-–—|]\s+/).map(tidy).filter(Boolean)
  const name = nameFrom(parts[0] ?? '')
  if (!name) return null
  // Location, job title, employer, when Google has them.
  const info = r.info?.length === 3 ? r.info.map(tidy) : null
  const second = parts[1] ?? ''
  const at = second && !truncated(second) ? splitAt(second) : null
  const experience = r.description.match(/Experience:\s*([^·\n]+?)(?:\s*·|$)/i)?.[1]
  const plainEmployer = parts.length === 2 && !at && second && !isTitle(second) ? second : ''
  const jobTexts = [info?.[1], at?.[0], plainEmployer ? '' : second].map(tidy).filter((t, i, all) => t && !truncated(t) && all.indexOf(t) === i)
  const title = jobTexts[0] ?? ''
  const company = [info?.[2], at?.[1], parts.length >= 3 ? parts[2] : '', experience, plainEmployer].map(tidy).find((c) => c && !truncated(c) && c.length <= 120) ?? ''
  const site = r.url.match(/^https?:\/\/([a-z]{2})\.linkedin\.com\//i)?.[1]?.toLowerCase()
  const country = countryIn(info?.[0]) ?? (site && COUNTRY_SITES[site] ? canonicalCountry(COUNTRY_SITES[site]) : null) ?? countryIn(r.description.match(/Location:\s*([^·\n]+?)(?:\s*·|$)/i)?.[1])
  return { profileUrl, firstName: name[0], lastName: name[1], jobTexts, title, company, country }
}

/** A phrase as Google takes it exactly: quoted, with any quotes inside dropped. */
export const phrase = (text: string) => `"${text.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim()}"`

/** "site:linkedin.com/in", or a country's own site (uk.linkedin.com). */
export const profileSite = (sub: string | null = null) => `site:${sub ? `${sub}.` : ''}linkedin.com/in`

/** Phrases joined with OR, in brackets when there's more than one. */
export function anyOf(phrases: string[]): string {
  const quoted = phrases.map(phrase)
  return quoted.length === 1 ? quoted[0] : `(${quoted.join(' OR ')})`
}
