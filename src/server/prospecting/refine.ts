import { isLineOfWork } from './companies'
import type { PersonResult } from './types'

/**
 * A search result corrected from the person's profile: their current job's
 * real title and employer, rather than what was guessed from their headline.
 * A current job without a company page still has its title and employer
 * name; only the company link stays unknown. A profile that names the
 * employer but no title keeps the title the search matched (`titleExact`
 * says which it is). Either way the title is shown without the employer's
 * name in it (titleAlone). Null when the profile listed no current job,
 * which leaves the search result as it was.
 */
export function refineFromProfile(person: PersonResult, profile: PersonResult | null): PersonResult | null {
  if (!profile || (!profile.title && !profile.company && !profile.companyRef)) return null
  return {
    ...person,
    title: titleAlone(profile.title || person.title, profile.company || person.company),
    titleExact: Boolean(profile.title),
    seniority: profile.title ? profile.seniority : person.seniority,
    company: profile.company || person.company,
    companyRef: profile.companyRef ?? person.companyRef,
    companySlug: profile.companySlug ?? person.companySlug ?? null,
    country: person.country ?? profile.country,
  }
}

type Word = { text: string; at: number }

const wordsIn = (s: string): Word[] =>
  [...s.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ text: m[0].normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase(), at: m.index! }))

const LEGAL_ENDING = new Set(['ltd', 'limited', 'llc', 'llp', 'inc', 'plc', 'gmbh', 'corp', 'corporation'])

/** What joins a job to its employer: "Owner, Acme", "CEO @ Acme", "Founder at Acme"… */
const JOINED = /(?:[,:;|@(/\-–—]\s*|\sat\s+)(?:the\s+)?$/i
/** …and "Founder of Acme", which is also how a job is said ("Head of Sales"). */
const JOINED_BY_OF = /\s(?:of|for)\s+(?:the\s+)?$/i
const TRAILING = /(?:[\s,:;|@(/&+\-–—]+|\s(?:of|at|for|and|the))$/i

/**
 * A job title without the employer's name in it. Many people write their
 * title, or their headline, as "Owner, Acme Marketing", "Founder of Acme" or
 * "CEO Acme Marketing: Chairman, Some Society"; the employer has its own
 * column, so the title stops where its name starts. The name counts when two
 * or more of its opening words are there ("Teak Media + Communication" for
 * Teak Media Communications), or all of a one-word name or its initials
 * after something that joins them (", ", " of ", " - "): never a plain space,
 * which would take "Senior Curator" for a job at Curator. Words that name a
 * line of work count only as the whole name after punctuation or "at", so
 * "Director of Digital Marketing" at Digital Marketing Agency keeps its job.
 * "As CEO" loses its "As". A title that would be left empty stays as it was.
 */
export function titleAlone(title: string, company: string): string {
  const opening = title.trim().replace(/^as\s+(?:an?\s+|the\s+)?(?=\S)/i, '')
  // The name as people say it: without a leading "The" or a closing "Ltd".
  const said = wordsIn(company).filter((w, i) => !(i === 0 && w.text === 'the'))
  const name = said.length > 1 && LEGAL_ENDING.has(said.at(-1)!.text) ? said.slice(0, -1) : said
  const words = wordsIn(opening)
  let cut = -1
  for (let i = 1; i < words.length && cut === -1 && name.length; i++) {
    let run = 0
    while (run < name.length && words[i + run]?.text === name[run].text) run++
    const before = opening.slice(0, words[i].at)
    const joined = JOINED.test(before)
    const whole = run === name.length
    const written = opening.slice(words[i].at, words[i].at + name.length)
    const initials = name.length >= 3 && words[i].text === name.map((w) => w.text[0]).join('') && written === written.toUpperCase()
    const ordinary = run > 0 && name.slice(0, run).every((w) => isLineOfWork(w.text))
    if (ordinary ? whole && joined : run >= 2 || (whole && name[0].text.length >= 3 && (joined || JOINED_BY_OF.test(before))) || (initials && joined)) cut = words[i].at
  }
  let alone = cut === -1 ? opening : opening.slice(0, cut)
  for (let before = ''; before !== alone; ) {
    before = alone
    alone = alone.replace(TRAILING, '')
  }
  return alone.trim() || title
}
