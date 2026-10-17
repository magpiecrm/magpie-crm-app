// Email candidate generation from a person's name and company domain.
//
// Pure functions only — no I/O — so the ranking can be unit-tested against
// awkward names (accents, hyphens, apostrophes, particles like "van der").

import { JOB_WORDS } from './jobWords'

/**
 * Local-part patterns, most likely first. Order follows Sendburg's 2025 study
 * of 336,782 B2B work emails (send-burg.com/research/b2b-email-formats):
 * first.last 47.7%, flast 26.8%, first 8.1%, firstlast 2.3%, first_last 2.3%,
 * f.last 2.1%, last 1.2%, last.first 0.65%, first.l 0.13%, first-last 0.1%.
 * The first six cover about 89% of addresses, which matters because a person
 * gets at most six checks. Rarer shapes follow for alternate name spellings.
 */
const PATTERNS = [
  '{first}.{last}',
  '{f}{last}',
  '{first}',
  '{first}{last}',
  '{first}_{last}',
  '{f}.{last}',
  '{last}',
  '{last}.{first}',
  '{first}.{l}',
  '{first}-{last}',
  '{first}{l}',
  '{last}{f}',
  '{f}{l}',
  '{last}{first}',
  '{f}_{last}',
] as const
export type EmailPattern = string

// Letters NFD decomposition does not split into base + combining mark.
const SPECIAL_LETTERS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  þ: 'th',
  ı: 'i',
}

// Titles, suffixes and credentials that appear in LinkedIn name fields but are
// never part of a mailbox name.
const NOISE_TOKENS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'dame',
  'jr', 'sr', 'ii', 'iii', 'iv',
  'phd', 'mba', 'msc', 'bsc', 'ba', 'ma', 'md', 'cpa', 'cfa', 'pmp', 'acca', 'aca', 'frsa', 'ceng', 'mcips',
])

// Surname particles. "Ludwig van Beethoven" is commonly both vanbeethoven@ and
// beethoven@, so both are generated with the full form ranked first.
const PARTICLES = new Set([
  'van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'dos', 'das', 'du', 'la', 'le', 'st', 'ter', 'ten', 'bin', 'al', 'el',
])

/** Lowercase ASCII with accents folded and apostrophes/periods dropped. */
export function foldName(raw: string): string {
  let s = raw.toLowerCase()
  s = s.replace(/[ßæœøđðłþı]/g, (ch) => SPECIAL_LETTERS[ch] ?? ch)
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // O'Brien -> obrien, St. John -> st john
  s = s.replace(/['’‘`´.]/g, '')
  return s
}

/**
 * A tagline after the name: "Doe | Growth Marketing", "Doe • Coach", or
 * "Doe - Founder" (a spaced dash only when what follows names a job, so the
 * double-barrelled "Smith - Jones" keeps both halves).
 */
function withoutTagline(raw: string): string {
  // A middle dot only with spaces round it: in Catalan names (Col·lell) it's part of the name.
  const cut = raw.split(/\s*[|•]\s*|\s+·\s+/)[0]
  const dash = cut.match(/^(.*?\S)\s+[-–—]\s+(.+)$/)
  if (dash && dash[2].toLowerCase().split(/[^a-z]+/).some((w) => JOB_WORDS.has(w))) return dash[1]
  return cut
}

/** Strips bracketed notes, post-comma credentials, taglines and emoji. */
function cleanNameField(raw: string): string {
  return withoutTagline(raw.replace(/\([^)]*\)|\[[^\]]*\]/g, ' '))
    .split(',')[0]
    .replace(/[^\p{L}\p{M}\s'’‘`´.-]/gu, ' ')
}

function tokens(raw: string, fold: (s: string) => string = foldName): string[] {
  return fold(cleanNameField(raw))
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z-]/g, '').replace(/^-+|-+$/g, ''))
    .filter((t) => t && !NOISE_TOKENS.has(t))
}

/** Every mailbox spelling of one name part, most likely first. */
function partVariants(parts: string[]): string[] {
  if (parts.length === 0) return []
  const out: string[] = []
  const push = (v: string) => {
    if (v && !out.includes(v)) out.push(v)
  }

  const joined = parts.join('')
  // Hyphenated parts: "smith-jones" -> smithjones, smith-jones, smith, jones
  push(joined.replace(/-/g, ''))
  if (joined.includes('-')) push(parts.join('-'))

  const withoutParticles = parts.filter((p) => !PARTICLES.has(p))
  if (withoutParticles.length > 0 && withoutParticles.length < parts.length) {
    push(withoutParticles.join('').replace(/-/g, ''))
  }

  const pieces = parts.flatMap((p) => p.split('-')).filter((p) => p && !PARTICLES.has(p))
  if (pieces.length > 1) {
    push(pieces[0])
    push(pieces[pieces.length - 1])
  }
  return out
}

/** A surname's words without job words after it: "Doe CEO" is Doe. The surname itself, particles and all ("de Chair"), stays. */
function withoutJobWords(last: string[]): string[] {
  const surname = last.findIndex((t) => !PARTICLES.has(t))
  return last.filter((t, i) => i <= surname || !JOB_WORDS.has(t))
}

/**
 * What's awkward about a name for guessing its mailbox, for the finder's
 * counts (finderStats.ts): kinds only, never the name.
 */
export function nameShapes(firstName: string, lastName: string): string[] {
  const raw = `${firstName} ${lastName}`
  const shapes: string[] = []
  if (/-/.test(raw.replace(/\s[-–—]\s/g, ' '))) shapes.push('hyphen')
  // Letters beyond plain ASCII (José, Müller), not emoji, curly apostrophes or dashes.
  if (/[\p{L}\p{M}]/u.test(raw.replace(/[\x00-\x7f]/g, ''))) shapes.push('accent')
  if (/[()[\]"“”]/.test(raw)) shapes.push('bracket')
  const tokensOfLast = tokens(lastName)
  const last = withoutJobWords(tokensOfLast)
  if (withoutTagline(lastName) !== lastName || last.length < tokensOfLast.length) shapes.push('tagline')
  if (last.some((t) => PARTICLES.has(t))) shapes.push('particle')
  else if (last.length > 1) shapes.push('multiword')
  return shapes.length ? shapes : ['plain']
}

export interface NameVariants {
  first: string[]
  last: string[]
  /** Shorter forms of the first name it's often written as in a mailbox (Chris for Christopher), tried only as first.last. */
  nick: string[]
}

/** German umlauts written out (Müller as mueller), as German-speaking firms often do in addresses. */
const foldGerman = (raw: string) => foldName(raw.replace(/[äöüÄÖÜ]/g, (ch) => ({ ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' })[ch]!))
const GERMAN_SPEAKING = /^(germany|deutschland|austria|österreich|osterreich|switzerland|schweiz|suisse|de|at|ch)$/i

/** Words in brackets or quotes that aren't a name someone goes by. */
const NOT_A_GIVEN_NAME = new Set(['she', 'he', 'they', 'her', 'him', 'them', 'hers', 'his', 'theirs', 'nee', 'née', 'ne', 'formerly', 'fka'])

/** The name someone goes by, given in brackets or quotes after their formal one: "Jonathan (Jon)", 'Robert "Bob"'. */
function givenInBrackets(raw: string): string | null {
  const m = raw.match(/[(“"]\s*([\p{L}'’-]+)\s*[)”"]/u)
  const word = m ? foldName(m[1]).replace(/[^a-z-]/g, '') : ''
  return word.length >= 2 && !NOT_A_GIVEN_NAME.has(word) ? word : null
}

/** Usual shorter forms of common first names. Only ever tried after the name as given, and only as first.last. */
const NICKNAMES: Record<string, string[]> = {
  alexander: ['alex'], alexandra: ['alex'], andrew: ['andy'], anthony: ['tony'], benjamin: ['ben'], catherine: ['cath', 'kate'],
  charles: ['charlie'], christopher: ['chris'], christine: ['chris'], daniel: ['dan'], david: ['dave'], edward: ['ed'],
  elizabeth: ['liz', 'beth'], gregory: ['greg'], james: ['jim', 'jamie'], jennifer: ['jen'], jonathan: ['jon'], joseph: ['joe'],
  katherine: ['kate', 'kath'], kenneth: ['ken'], margaret: ['maggie'], matthew: ['matt'], michael: ['mike'], nicholas: ['nick'],
  patrick: ['pat'], peter: ['pete'], rebecca: ['becky'], richard: ['rich'], robert: ['rob'], samuel: ['sam'], stephanie: ['steph'],
  stephen: ['steve'], steven: ['steve'], thomas: ['tom'], timothy: ['tim'], victoria: ['vicky'], william: ['will'],
}

/**
 * Normalises a provider's first/last name pair. When the provider only gives a
 * full name in `firstName` the last token becomes the surname. With the
 * person's `country`, German-speaking ones get Müller as mueller first.
 */
export function nameVariants(firstName: string, lastName: string, opts: { country?: string | null } = {}): NameVariants {
  const spelt = (fold: (s: string) => string) => {
    let firstTokens = tokens(firstName, fold)
    let lastTokens = tokens(lastName, fold)
    if (lastTokens.length === 0 && firstTokens.length > 1) {
      lastTokens = firstTokens.slice(1)
      firstTokens = firstTokens.slice(0, 1)
    }
    // A job after the surname ("Doe CEO") is a tagline; a surname that is a job word ("Dean", "de Chair") stays.
    lastTokens = withoutJobWords(lastTokens)
    // A middle name is rarely in the mailbox: "Mary Ann" -> mary, maryann.
    const first = partVariants(firstTokens.slice(0, 1))
    if (firstTokens.length > 1) {
      const combined = firstTokens.join('').replace(/-/g, '')
      if (!first.includes(combined)) first.push(combined)
    }
    return { first, last: partVariants(lastTokens) }
  }
  const plain = spelt(foldName)
  const german = spelt(foldGerman)
  const germanFirst = GERMAN_SPEAKING.test(opts.country?.trim() ?? '')
  const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])]
  const first = germanFirst ? merge(german.first, plain.first) : merge(plain.first, german.first)
  const last = germanFirst ? merge(german.last, plain.last) : merge(plain.last, german.last)
  // The name they go by, in brackets, is the one their mailbox most likely has.
  const given = givenInBrackets(firstName)
  if (given) {
    const at = first.indexOf(given)
    if (at > 0) first.splice(at, 1)
    if (at !== 0) first.unshift(given)
  }
  const nick = (NICKNAMES[plain.first[0] ?? ''] ?? []).filter((n) => !first.includes(n))
  return { first, last, nick }
}

const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/

export function applyPattern(pattern: EmailPattern, first: string, last: string): string | null {
  if (pattern.includes('{first}') || pattern.includes('{f}')) {
    if (!first) return null
  }
  if (pattern.includes('{last}') || pattern.includes('{l}')) {
    if (!last) return null
  }
  const local = pattern
    .replace('{first}', first)
    .replace('{last}', last)
    .replace('{f}', first.charAt(0))
    .replace('{l}', last.charAt(0))
  if (!LOCAL_PART_RE.test(local) || local.includes('..')) return null
  return local
}

export interface Candidate {
  email: string
  pattern: EmailPattern
}

/**
 * The order formats are tried in at a small firm, from the addresses
 * verified at hq (October 2026): at companies of 1-10 people `{first}` was
 * 70% of them (243 of 348) and first.last 20%; at 11-50, 52% and 32%. Only
 * the order: how likely an unconfirmed guess is stays formatStats.ts's.
 */
const SMALL_FIRM_ORDER: readonly EmailPattern[] = ['{first}', '{first}.{last}', '{f}{last}', '{first}{last}', '{f}.{last}', '{first}_{last}']
export const FORMAT_ORDER = {
  general: PATTERNS as readonly EmailPattern[],
  smallFirm: [...SMALL_FIRM_ORDER, ...PATTERNS.filter((p) => !SMALL_FIRM_ORDER.includes(p))] as readonly EmailPattern[],
}

/**
 * Ranked candidates for one person. With a trusted `knownPattern` the list
 * starts with that pattern applied to every name variant; the generic ranking
 * still follows so a stale pattern can fall through to the rest.
 *
 * The checks a person gets (`max`, six in practice) are spent on the likely
 * formats and spellings together: with a second spelling (Smith-Jones and
 * Smith, Müller and Mueller, the name in brackets) the plan is the top format
 * as spelt first, the second, the top as spelt second, the third, the second
 * as spelt second, the top as spelt third; then the rest in order. A usual
 * shorter first name (Chris) is only tried as first.last, after the name as
 * given. `firstLeads`: a small firm whose own domain this is, where `{first}`
 * comes first (FORMAT_ORDER.smallFirm).
 */
export function generateCandidates(
  firstName: string,
  lastName: string,
  domain: string,
  opts: { knownPattern?: EmailPattern | null; max?: number; firstLeads?: boolean; country?: string | null } = {},
): Candidate[] {
  const { first, last, nick } = nameVariants(firstName, lastName, { country: opts.country })
  const max = opts.max ?? 10
  const out: Candidate[] = []
  const seen = new Set<string>()

  const add = (pattern: EmailPattern, f: string, l: string) => {
    const local = applyPattern(pattern, f, l)
    if (!local) return
    const email = `${local}@${domain}`
    if (seen.has(email)) return
    seen.add(email)
    out.push({ email, pattern })
  }

  const primaryFirst = first[0] ?? ''
  const primaryLast = last[0] ?? ''

  if (opts.knownPattern) {
    add(opts.knownPattern, primaryFirst, primaryLast)
    for (const f of first) for (const l of last) add(opts.knownPattern, f, l)
  }

  const order = opts.firstLeads ? FORMAT_ORDER.smallFirm : FORMAT_ORDER.general
  // The spellings, most likely first: as given, then a second surname or first name spelling.
  const spellings: Array<[string, string]> = []
  for (const [f, l] of [[primaryFirst, primaryLast], ...last.slice(1).map((l) => [primaryFirst, l]), ...first.slice(1).map((f) => [f, primaryLast])] as Array<[string, string]>) {
    if (!spellings.some(([a, b]) => a === f && b === l)) spellings.push([f, l])
  }
  const [s1, s2, s3] = spellings
  const [f1, f2, f3] = order
  if (s2) {
    // For a spelling that only changes the surname, the formats that have one (`{first}` would be the same address).
    const withSurname = order.filter((p) => /\{l(ast)?\}/.test(p))
    const nth = (s: [string, string], i: number) => (s[0] === primaryFirst ? withSurname : order)[i]
    const plan: Array<[EmailPattern, [string, string]] | null> = [[f1, s1], [f2, s1], [nth(s2, 0), s2], [f3, s1], [nth(s2, 1), s2], s3 ? [nth(s3, 0), s3] : null]
    for (const step of plan) if (step) add(step[0], step[1][0], step[1][1])
  }
  // The rest of the formats as spelt first; a shorter first name as first.last after the first four.
  order.forEach((pattern, i) => {
    if (i === 4) for (const n of nick) add('{first}.{last}', n, primaryLast)
    add(pattern, primaryFirst, primaryLast)
  })

  // Then other spellings for the two most likely formats.
  for (const pattern of order.slice(0, 2)) {
    for (const f of first) for (const l of last) add(pattern, f, l)
  }

  return out.slice(0, max)
}

/**
 * Whether today's guesses for a name try an address the guesses before
 * 0.9.96 never did (they tried the six commonest formats as the name was
 * first spelt): someone every one of those was rejected for may be found now.
 */
export function guessesChangedFor(firstName: string, lastName: string): boolean {
  const { first, last } = nameVariants(firstName, lastName)
  const before = new Set(PATTERNS.slice(0, 6).map((p) => applyPattern(p, first[0] ?? '', last[0] ?? '')).filter(Boolean))
  const now = [...generateCandidates(firstName, lastName, 'x.invalid', { max: 6 }), ...generateCandidates(firstName, lastName, 'x.invalid', { max: 6, firstLeads: true })]
  return now.some((c) => !before.has(c.email.split('@')[0]))
}

/** Recovers which pattern produced a verified address, for pattern learning, whichever spelling of the name it used. */
export function inferPattern(email: string, firstName: string, lastName: string): EmailPattern | null {
  const local = email.split('@')[0]?.toLowerCase()
  if (!local) return null
  const { first, last, nick } = nameVariants(firstName, lastName)
  for (const f of [...first, ...nick]) {
    for (const l of last.length ? last : ['']) {
      for (const pattern of PATTERNS) {
        if (applyPattern(pattern, f, l) === local) return pattern
      }
    }
  }
  return null
}
