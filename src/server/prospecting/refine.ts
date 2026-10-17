import { isLineOfWork } from './companies'
import { JOB_WORDS } from './jobWords'
import { classifySeniority } from './seniority'
import { sameCompanyName } from './socialfetch'
import type { CurrentJob, PersonResult } from './types'

/**
 * A search result corrected from the person's profile: their current job's
 * real title and employer, rather than what was guessed from their headline.
 * A current job without a company page still has its title and employer
 * name; only the company link stays unknown. A profile that names the
 * employer but no title keeps the title the search matched (`titleExact`
 * says which it is). Either way the title is shown without the employer's
 * name in it (titleAlone). Null when the profile listed no current job,
 * which leaves the search result as it was.
 *
 * Someone who holds several jobs at once is shown in the one the search was
 * about (currentJob): `searched` says whether an employer is one the search
 * was for.
 */
export function refineFromProfile(
  person: PersonResult,
  profile: PersonResult | null,
  searched?: (job: Employer) => boolean,
  opts: {
    /** Whether a job title is one the search was for (socialfetch.ts fitsTitles). */
    titleFits?: (title: string) => boolean
    /** Hears which job was taken: another of theirs at a company searched, or one there refused for want of evidence. */
    noted?: (how: 'other' | 'refused') => void
  } = {},
): PersonResult | null {
  if (!profile || (!profile.title && !profile.company && !profile.companyRef)) return null
  const job = currentJob(person, profile, searched, opts)
  return {
    ...person,
    title: titleAlone(job.title || person.title, job.company || person.company),
    titleExact: Boolean(job.title),
    seniority: job.title ? classifySeniority(job.title) : person.seniority,
    company: job.company || person.company,
    companyRef: job.companyRef ?? person.companyRef,
    companySlug: job.companySlug ?? person.companySlug ?? null,
    country: person.country ?? profile.country,
    // The start of the job shown, not of their others (signals.ts: new in role).
    ...(job.startedOn ? { roleStartedOn: job.startedOn } : {}),
  }
}

type Employer = Pick<CurrentJob, 'company' | 'companyRef'>

/**
 * Which of someone's current jobs they're shown in. A profile lists them in
 * its own order, and a founder's own firm is often second to a board seat or
 * a teaching post: taking the first alone left them out of a search for
 * people at their firm as "working somewhere else", after their profile had
 * been paid for. So the job at a company the search was for is taken when
 * it's their first, or when something else says it's real: its title is one
 * searched for, or their headline names that employer. People rarely end
 * old jobs on LinkedIn, and a forgotten one at the company searched, taken
 * on its own, had emails guessed at a company they'd left (0.9.85-0.9.89).
 * Otherwise the job at the employer their headline named; else the first.
 */
function currentJob(
  person: PersonResult,
  profile: PersonResult,
  searched: ((job: Employer) => boolean) | undefined,
  opts: { titleFits?: (title: string) => boolean; noted?: (how: 'other' | 'refused') => void },
): CurrentJob {
  const first: CurrentJob = { title: profile.title, company: profile.company, companyRef: profile.companyRef, companySlug: profile.companySlug, startedOn: profile.roleStartedOn }
  if (!profile.otherJobs?.length) return first
  const jobs = [first, ...profile.otherJobs]
  const named = (job: Employer) =>
    Boolean(person.companyRef && job.companyRef === person.companyRef) || Boolean(person.company.trim() && job.company && sameCompanyName(job.company, person.company))
  if (searched && !searched(first)) {
    const other = profile.otherJobs.find(searched)
    if (other && (named(other) || Boolean(other.title && opts.titleFits?.(other.title)))) {
      opts.noted?.('other')
      return other
    }
    if (other) opts.noted?.('refused')
  }
  return (searched?.(first) ? first : undefined) ?? jobs.find(named) ?? first
}

type Word = { text: string; at: number }

const wordsIn = (s: string): Word[] =>
  [...s.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ text: m[0].normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase(), at: m.index! }))

const LEGAL_ENDING = new Set(['ltd', 'limited', 'llc', 'llp', 'inc', 'plc', 'gmbh', 'corp', 'corporation'])

/** Words a job is named with. A part of a title with none of them is a company's name or a slogan. */
/** "Lead generation" is something sold, not someone's job. */
const namesJob = (words: Word[]) => words.some((w, i) => JOB_WORDS.has(w.text) && !(w.text === 'lead' && /^gen/.test(words[i + 1]?.text ?? '')))
/** Sides of a business that aren't lines of work in themselves. */
const SIDES = new Set(
  `account accounts alliances analytics and brand channel client commercial compliance corporate customer data development enterprise global
  growth innovation international operations partnerships people performance procurement product programs quality regional research revenue
  risk strategic strategy success supply talent`.split(/\s+/),
)
/** "VP, Marketing", "SVP, Strategic Account Sales": the part after says which side of the business. */
const namesSide = (words: Word[]) => words.length > 0 && words.length <= 4 && words.every((w) => isLineOfWork(w.text) || SIDES.has(w.text))

/** What joins a job to its employer: "Owner, Acme", "CEO @ Acme", "Founder at Acme"… */
const JOINED = /(?:[,:;|@(/\-–—]\s*|\sat\s+)(?:the\s+)?$/i
/** …and "Founder of Acme", which is also how a job is said ("Head of Sales"). */
const JOINED_BY_OF = /\s(?:of|for)\s+(?:the\s+)?$/i
const TRAILING = /(?:[\s,:;|@(/&+\-–—]+|\s(?:of|at|for|and|the|a|an|in|with|to))$/i
/** Where one part of a title ends: punctuation, a spaced dash or slash, an emoji, " at ", or a capital I standing in for a bar. */
const PART_ENDS = /\s*[,;:|(]\s*|\s*\/\/\s*|\s+[-–—/]\s+|\s*[\p{Extended_Pictographic}\p{So}][\p{Extended_Pictographic}\p{So}\p{M}\u200d]*\s*|\s+(?:at|@)\s+|@|\s+I\s+/gu
/**
 * Someone is the owner, founder or chief of an organisation, never of a
 * side of one, so what follows "of" there is the organisation's name
 * ("Owner of Simplicity Design", "COO of Hometown Marketing"), unless it's
 * plainly a side after all ("President of Sales"). "Head of", "Director of"
 * and "VP of" are followed by the job itself.
 */
const HEAD_OF_AN_ORGANISATION =
  /\b(?:owner|co-?owner|founder|co-?founder|proprietor|principal|partner|(?<!vice[ -])president|chair(?:man|woman|person)?|managing director|ceo|coo|cfo|cto|cmo|cio|cro|chief [\p{L}]+(?: [\p{L}]+)? officer)\s+(?:of|for)\s+(?!the board\b)/iu

/**
 * A job title on its own: without the employer's name, another
 * organisation's, or a slogan. Many people write their title, or their
 * headline, as "Owner, Acme Marketing", "Founder of Acme" or "CEO Acme
 * Marketing: Chairman, Some Society - Helping brands grow"; the employer
 * has its own column.
 *
 * The title stops where the employer's name starts. The name counts when
 * two or more of its opening words are there ("Teak Media + Communication"
 * for Teak Media Communications), or all of a one-word name or its initials
 * after something that joins them (", ", " of ", " - "), or straight after a
 * job word ("Managing Director Colourmedia"): never after just any word,
 * which would take "Senior Curator" for a job at Curator. Words that name a
 * line of work count only as the whole name after punctuation or "at", so
 * "Director of Digital Marketing" at Digital Marketing Agency keeps its job.
 *
 * Then it stops at the first part (after a comma, a dash, a colon…) that
 * names no job and no side of the business, and at "of" after owner,
 * founder and the like. A leading "As" or bullet goes. A title that would be
 * left empty stays as it was.
 */
export function titleAlone(title: string, company: string): string {
  const opening = title
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^as\s+(?:an?\s+|the\s+)?(?=\S)/i, '')
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
    const afterJob = JOB_WORDS.has(words[i - 1].text) && /^\s+$/.test(opening.slice(words[i - 1].at + words[i - 1].text.length, words[i].at))
    if (ordinary ? whole && joined : run >= 2 || (whole && name[0].text.length >= 3 && (joined || afterJob || JOINED_BY_OF.test(before))) || (initials && joined)) cut = words[i].at
  }
  let alone = cut === -1 ? opening : opening.slice(0, cut)
  // "Acme Marketing Founder": the name first, then the job.
  if (name.length >= 2 && words.length > name.length && name.every((w, i) => words[i].text === w.text) && !name.every((w) => isLineOfWork(w.text))) alone = alone.slice(words[name.length].at)

  // Its parts, from the first that names a job to the last before one that
  // names neither a job nor a side of the business: what comes before is a
  // slogan, what comes after another organisation or a description.
  const parts: Array<{ from: number; to: number; words: Word[] }> = []
  let at = 0
  for (const m of [...alone.matchAll(PART_ENDS), null]) {
    const to = m ? m.index : alone.length
    parts.push({ from: at, to, words: wordsIn(alone.slice(at, to)) })
    at = m ? m.index + m[0].length : to
  }
  const spoken = parts.filter((p) => p.words.length)
  const first = Math.max(0, spoken.findIndex((p) => namesJob(p.words)))
  let last = first
  while (spoken[last + 1] && (namesJob(spoken[last + 1].words) || namesSide(spoken[last + 1].words))) last++
  if (spoken.length) alone = alone.slice(spoken[first].from, spoken[last].to)
  const of = alone.match(HEAD_OF_AN_ORGANISATION)
  if (of && !namesSide(wordsIn(alone.slice(of.index! + of[0].length)))) alone = alone.slice(0, of.index! + of[0].search(/\s+(?:of|for)\s+$/i))

  for (let before = ''; before !== alone; ) {
    before = alone
    alone = alone.replace(TRAILING, '')
  }
  return alone.trim() || title
}
