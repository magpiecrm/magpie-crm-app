// Email candidate generation from a person's name and company domain.
//
// Pure functions only — no I/O — so the ranking can be unit-tested against
// awkward names (accents, hyphens, apostrophes, particles like "van der").

/**
 * Local-part patterns, most likely first. Ranking is the commonly observed
 * B2B order; `first.last` and `flast` together cover the large majority of
 * company mailboxes.
 */
const PATTERNS = [
  '{first}.{last}',
  '{f}{last}',
  '{first}',
  '{first}{l}',
  '{first}_{last}',
  '{last}{f}',
  '{last}.{first}',
  '{f}.{last}',
  '{first}{last}',
  '{last}',
  '{first}-{last}',
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

/** Strips bracketed notes, post-comma credentials and emoji. */
function cleanNameField(raw: string): string {
  return raw
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(',')[0]
    .replace(/[^\p{L}\p{M}\s'’‘`´.-]/gu, ' ')
}

function tokens(raw: string): string[] {
  return foldName(cleanNameField(raw))
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

export interface NameVariants {
  first: string[]
  last: string[]
}

/**
 * Normalises a provider's first/last name pair. When the provider only gives a
 * full name in `firstName` the last token becomes the surname.
 */
export function nameVariants(firstName: string, lastName: string): NameVariants {
  let firstTokens = tokens(firstName)
  let lastTokens = tokens(lastName)

  if (lastTokens.length === 0 && firstTokens.length > 1) {
    lastTokens = firstTokens.slice(1)
    firstTokens = firstTokens.slice(0, 1)
  }
  // A middle name is rarely in the mailbox: "Mary Ann" -> mary, maryann.
  const first = partVariants(firstTokens.slice(0, 1))
  if (firstTokens.length > 1) {
    const combined = firstTokens.join('').replace(/-/g, '')
    if (!first.includes(combined)) first.push(combined)
  }
  return { first, last: partVariants(lastTokens) }
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
 * Ranked candidates for one person. With a trusted `knownPattern` the list
 * starts with that pattern applied to every name variant; the generic ranking
 * still follows so a stale pattern can fall through to the rest.
 */
export function generateCandidates(
  firstName: string,
  lastName: string,
  domain: string,
  opts: { knownPattern?: EmailPattern | null; max?: number } = {},
): Candidate[] {
  const { first, last } = nameVariants(firstName, lastName)
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

  for (const pattern of PATTERNS) add(pattern, primaryFirst, primaryLast)

  // Alternate spellings only for the two dominant patterns, otherwise a
  // hyphenated double-barrelled name would burn the whole budget on variants.
  for (const pattern of PATTERNS.slice(0, 2)) {
    for (const f of first) for (const l of last) add(pattern, f, l)
  }

  return out.slice(0, max)
}

/** Recovers which pattern produced a verified address, for pattern learning. */
export function inferPattern(email: string, firstName: string, lastName: string): EmailPattern | null {
  const local = email.split('@')[0]?.toLowerCase()
  if (!local) return null
  const { first, last } = nameVariants(firstName, lastName)
  const f = first[0] ?? ''
  const l = last[0] ?? ''
  for (const pattern of PATTERNS) {
    if (applyPattern(pattern, f, l) === local) return pattern
  }
  return null
}
