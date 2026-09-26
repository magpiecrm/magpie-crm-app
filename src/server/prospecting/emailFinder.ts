// Finds one work email for one person at one domain.
//
//   1. MX lookup (cached per domain): no MX means the domain takes no mail.
//   2. Catch-all probe (once per domain, cached 180 days): a random address is
//      checked; if the server accepts it, nothing on that domain can be
//      verified and the best-ranked guess is returned as `catch_all_likely`.
//   3. Candidates in likelihood order — a trusted learned pattern first — are
//      checked through Reacher until the first `safe`.
//   4. A `safe` result on a non-catch-all domain teaches the domain its
//      pattern. Only the pattern is stored, never the name or address.
//
// Without a verifier configured, steps 2-4 are skipped and the top candidate
// is returned as `unverified`.

import crypto from 'crypto'
import type { EmailDomainRecord } from '../db'
import { firstLastLikelihood } from './formatStats'
import { generateCandidates, type Candidate } from './patterns'
import { providerFromMx, refusedIp, VerificationLimitError, type Lease, type MailProvider } from './proxyRouter'
import type { CheckResult } from './reacher'
import type { EmailStatus } from './types'

const DAY = 86_400_000
/** A learned address format is re-checked after this long. */
const DOMAIN_REFRESH_MS = 90 * DAY
/**
 * A company found to accept every address stays marked (and hidden from
 * search) this long before it's tested again. Longer than for formats: mail
 * setups rarely change, and each re-test is a check that can't succeed.
 */
const CATCH_ALL_REFRESH_MS = 180 * DAY
const MX_REFRESH_MS = 30 * DAY
/** A pattern at or above this confidence is tried first, on its own. */
const TRUSTED_CONFIDENCE = 0.8
/**
 * Reacher opens a fresh SMTP session per check, so the practical cap on RCPT
 * TO probes against one domain is checks per person, plus the per-provider
 * rate limits in the proxy router.
 */
const MAX_CHECKS_PER_PERSON = 6
/**
 * "Unknown" answers in a row, with nothing definite yet, before giving up on
 * a person: the mail server itself can't be checked, so more guesses would
 * only spend more probes for the same answer.
 */
const MAX_UNKNOWN_STREAK = 2
/** IPs one address is tried through when mail servers refuse the first. */
const MAX_IPS_PER_CHECK = 3
const REFUSED_EVERYWHERE = 'it refuses connections from every verification IP; one at a different hosting provider may get through'

// Second-level registries: "co.uk" is never anyone's mail domain.
const PUBLIC_SUFFIX_RE = /^(co|com|org|net|ac|gov|ltd|plc|edu|me|nhs|sch)\.[a-z]{2}$/

/**
 * A company's LinkedIn website is sometimes a subdomain that takes no mail
 * (careers.acme.com, uk.acme.com). Walk up to the first parent domain that
 * does. DNS only, no website fetching.
 */
async function parentWithMail(domain: string, deps: FinderDeps): Promise<{ domain: string; rec: EmailDomainRecord } | null> {
  const labels = domain.split('.')
  while (labels.length > 2) {
    labels.shift()
    const parent = labels.join('.')
    if (PUBLIC_SUFFIX_RE.test(parent)) return null
    const rec = await prepareDomain(parent, deps)
    if (rec.accepts_mail !== false) return { domain: parent, rec }
  }
  return null
}

/**
 * Whether `domain` is already known (from an earlier check, still fresh) to
 * accept every address, following the same walk to a parent domain that
 * `findEmail` takes when the domain itself takes no mail. Cache only: no DNS,
 * no checks, so search results can be marked without any SMTP traffic.
 */
export function isKnownCatchAll(domain: string, getDomain: FinderDeps['getDomain'], now: number): boolean {
  const labels = domain.toLowerCase().trim().split('.')
  for (;;) {
    const rec = getDomain(labels.join('.'))
    if (rec?.catch_all === true && !isStale(rec.catch_all_checked_at, CATCH_ALL_REFRESH_MS, now)) return true
    if (rec?.accepts_mail !== false || labels.length <= 2) return false
    labels.shift()
    if (PUBLIC_SUFFIX_RE.test(labels.join('.'))) return false
  }
}

/** LinkedIn shows some surnames as an initial ("Andy C."); no address can be guessed from that. */
export function surnameHidden(lastName: string): boolean {
  return /^\p{L}\.?$/u.test(lastName.trim())
}

export interface FinderDeps {
  getDomain(domain: string): EmailDomainRecord | null
  updateDomain(domain: string, patch: Partial<Omit<EmailDomainRecord, 'domain'>>): EmailDomainRecord
  /** MX hostnames; `[]` when the domain has none. Throws on lookup failure. */
  resolveMx(domain: string): Promise<string[]>
  /** Null when verification (Reacher) isn't set up. */
  verifier: {
    /** A slot to check an address at `domain`, within the per-IP and per-company limits. */
    acquire(provider: MailProvider, domain: string): Promise<Lease>
    check(email: string, lease: Lease, provider: MailProvider): Promise<CheckResult>
  } | null
  now(): number
  /** Another domain that might be the real mail domain, for a suggestion. */
  suggestMailDomain?(domain: string): Promise<string | null>
}

export interface FindResult {
  email: string | null
  status: EmailStatus
  /** At least one check was greylisted; worth retrying later for a better answer. */
  greylisted: boolean
  /** Why the answer isn't a verified address, in words the user can act on. */
  detail?: string
  /**
   * The same explanation without the best-guess advice ("This is the most
   * common format…"), for when an unconfirmed address is withheld.
   */
  reason?: string
  /** The domain itself takes no email, so a corrected company domain could help. */
  domainProblem?: boolean
  /** A domain that does take email, from the company's DNS, to offer the user. */
  suggestedDomain?: string
}

type Verifier = NonNullable<FinderDeps['verifier']>

/**
 * Checks one address, retrying through another IP when the company's mail
 * server refuses the one used (the router then keeps it away from that IP).
 * `result` is null when no IP was left to check from; `exhausted` means every
 * IP has now been refused, so further guesses there can't be checked either.
 */
async function verify(
  verifier: Verifier,
  email: string,
  domain: string,
  provider: MailProvider,
): Promise<{ result: CheckResult | null; exhausted: boolean }> {
  let result: CheckResult | null = null
  for (let attempt = 0; attempt < MAX_IPS_PER_CHECK; attempt++) {
    let lease: Lease
    try {
      lease = await verifier.acquire(provider, domain)
    } catch (err) {
      if (err instanceof VerificationLimitError && err.code === 'refused') return { result, exhausted: true }
      throw err
    }
    result = await verifier.check(email, lease, provider)
    lease.report(result.outcome, result.reachability === 'invalid')
    if (!refusedIp(result.outcome)) break
  }
  return { result, exhausted: false }
}

const isStale = (iso: string | null, maxAgeMs: number, now: number) =>
  !iso || now - new Date(iso).getTime() > maxAgeMs

function trustedPattern(rec: EmailDomainRecord | null, now: number): string | null {
  if (!rec?.pattern || rec.pattern_confidence < TRUSTED_CONFIDENCE) return null
  return isStale(rec.pattern_verified_at, DOMAIN_REFRESH_MS, now) ? null : rec.pattern
}

// Concurrent saves for people at the same company share one MX lookup and
// one catch-all probe instead of racing.
const inflight = new Map<string, Promise<EmailDomainRecord>>()

async function prepareDomain(domain: string, deps: FinderDeps): Promise<EmailDomainRecord> {
  const key = domain
  const existing = inflight.get(key)
  if (existing) return existing
  const task = (async () => {
    const now = deps.now()
    let rec = deps.getDomain(domain) ?? deps.updateDomain(domain, {})

    if (isStale(rec.mx_checked_at, MX_REFRESH_MS, now)) {
      try {
        const hosts = await deps.resolveMx(domain)
        rec = deps.updateDomain(domain, {
          accepts_mail: hosts.length > 0,
          mx_provider: hosts.length > 0 ? providerFromMx(hosts) : null,
          mx_checked_at: new Date(now).toISOString(),
        })
      } catch {
        // DNS hiccup: leave MX unknown and let verification decide.
      }
    }

    if (
      deps.verifier &&
      rec.accepts_mail !== false &&
      isStale(rec.catch_all_checked_at, CATCH_ALL_REFRESH_MS, now)
    ) {
      const probe = `${crypto.randomBytes(9).toString('hex')}@${domain}`
      const { result } = await verify(deps.verifier, probe, domain, rec.mx_provider ?? 'other')
      const catchAll = !result
        ? null
        : result.isCatchAll ?? (result.reachability === 'safe' || result.reachability === 'risky' ? true : result.reachability === 'invalid' ? false : null)
      if (catchAll !== null) {
        rec = deps.updateDomain(domain, { catch_all: catchAll, catch_all_checked_at: new Date(now).toISOString() })
      }
    }
    return rec
  })()
  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}

function learnPattern(domain: string, pattern: string, deps: FinderDeps) {
  const rec = deps.getDomain(domain)
  const now = new Date(deps.now()).toISOString()
  if (!rec?.pattern || rec.pattern === pattern) {
    const confidence = rec?.pattern === pattern ? Math.min(1, rec.pattern_confidence + 0.1) : TRUSTED_CONFIDENCE
    deps.updateDomain(domain, { pattern, pattern_confidence: confidence, pattern_verified_at: now })
  } else if (rec.pattern_confidence < TRUSTED_CONFIDENCE) {
    deps.updateDomain(domain, { pattern, pattern_confidence: TRUSTED_CONFIDENCE, pattern_verified_at: now })
  } else {
    // Mixed patterns at one company: weaken the old one rather than flip-flop.
    deps.updateDomain(domain, { pattern_confidence: Math.max(0, rec.pattern_confidence - 0.2) })
  }
}

export async function findEmail(
  person: { firstName: string; lastName: string },
  rawDomain: string,
  deps: FinderDeps,
  opts: { headcount?: number | null } = {},
): Promise<FindResult> {
  if (surnameHidden(person.lastName)) {
    return {
      email: null,
      status: 'not_found',
      greylisted: false,
      detail: `Their surname is hidden on LinkedIn (shown as "${person.lastName.trim()}"), so their address can't be worked out.`,
    }
  }

  let domain = rawDomain.toLowerCase().trim()
  let rec = await prepareDomain(domain, deps)
  if (rec.accepts_mail === false) {
    const parent = await parentWithMail(domain, deps)
    if (!parent) {
      const suggestion = (await deps.suggestMailDomain?.(domain).catch(() => null)) ?? undefined
      return {
        email: null,
        status: 'not_found',
        greylisted: false,
        detail: suggestion
          ? `${domain} doesn't receive email, but its DNS is run from ${suggestion}, which does.`
          : `${domain} doesn't receive email, so there's nothing to check.`,
        domainProblem: true,
        suggestedDomain: suggestion,
      }
    }
    ;({ domain, rec } = parent)
  }

  const known = trustedPattern(rec, deps.now())
  const candidates: Candidate[] = generateCandidates(person.firstName, person.lastName, domain, {
    knownPattern: known,
    max: MAX_CHECKS_PER_PERSON,
  })
  if (candidates.length === 0) {
    return { email: null, status: 'not_found', greylisted: false, detail: "Their name can't be turned into an email address." }
  }

  // How much to trust an unconfirmed best guess, in words.
  const likelihood = known
    ? 'It matches the format already confirmed for others at this company.'
    : candidates[0].pattern === '{first}.{last}'
      ? firstLastLikelihood(opts.headcount)
      : 'This is the most likely format.'
  const catchAllReason = `${domain} accepts every address, so none can be confirmed.`
  const catchAll: FindResult = {
    email: candidates[0].email,
    status: 'catch_all_likely',
    greylisted: false,
    reason: catchAllReason,
    detail: `${catchAllReason} ${likelihood}`,
  }
  if (rec.catch_all) return catchAll
  if (!deps.verifier) {
    return {
      email: candidates[0].email,
      status: 'unverified',
      greylisted: false,
      reason: 'Email verification is off, so no address could be confirmed.',
      detail: `Not checked: email verification is off. ${likelihood}`,
    }
  }

  let firstRisky: string | null = null
  let greylisted = false
  let anyDefinite = false
  let lastProblem: string | undefined
  let tried = 0
  let unknownStreak = 0
  // Per-domain verdict counts for the log: company data only, no addresses.
  const tally: Record<string, number> = {}
  const done = (r: FindResult): FindResult => {
    const counts = Object.entries(tally).map(([k, n]) => `${k} ${n}`).join(', ')
    console.log(`[EmailFinder] ${domain} (${rec.mx_provider ?? '?'}): ${counts || 'no checks'} -> ${r.status}`)
    return r
  }

  for (const candidate of candidates) {
    const { result, exhausted } = await verify(deps.verifier, candidate.email, domain, rec.mx_provider ?? 'other')
    if (!result) {
      lastProblem = REFUSED_EVERYWHERE
      break
    }
    const verdict = result.isCatchAll ? 'catch-all' : result.reachability
    tally[verdict] = (tally[verdict] ?? 0) + 1
    tried++
    if (result.detail) lastProblem = result.detail

    if (result.isCatchAll) {
      // The probe missed it (or it was never run); record and stop guessing.
      deps.updateDomain(domain, { catch_all: true, catch_all_checked_at: new Date(deps.now()).toISOString() })
      return done(catchAll)
    }

    if (result.reachability === 'safe') {
      learnPattern(domain, candidate.pattern, deps)
      return done({ email: candidate.email, status: 'verified', greylisted: false })
    }
    if (result.reachability === 'risky') {
      anyDefinite = true
      firstRisky ??= candidate.email
    } else if (result.reachability === 'invalid') {
      anyDefinite = true
      if (known && candidate.pattern === known) {
        deps.updateDomain(domain, { pattern_confidence: Math.max(0, rec.pattern_confidence - 0.3) })
      }
    } else if (result.outcome === 'greylisted') {
      greylisted = true
    }

    if (exhausted && result.reachability === 'unknown') {
      lastProblem = REFUSED_EVERYWHERE
      break
    }
    if (result.reachability === 'unknown' && result.outcome !== 'greylisted' && !anyDefinite) {
      if (++unknownStreak >= MAX_UNKNOWN_STREAK) break
    } else {
      unknownStreak = 0
    }
  }

  if (firstRisky) {
    return done({
      email: firstRisky,
      status: 'risky',
      greylisted,
      reason: `${domain}'s mail server only gave a risky answer, so no address could be confirmed.`,
      detail: 'The mail server accepted this address but flagged it as risky.',
    })
  }
  // Nothing definite came back (greylisting, timeouts): keep the best guess.
  if (!anyDefinite || greylisted) {
    const reason = greylisted
      ? `${domain}'s mail server asked us to try again later, so no address could be confirmed yet.`
      : `${domain}'s mail server couldn't be checked${lastProblem ? ` (${lastProblem.replace(/\.$/, '')})` : ''}, so no address could be confirmed.`
    return done({
      email: candidates[0].email,
      status: 'unverified',
      greylisted,
      reason,
      detail: greylisted
        ? `${domain}'s mail server asked us to try again later. ${likelihood}`
        : `${domain}'s mail server couldn't be checked${lastProblem ? ` (${lastProblem.replace(/\.$/, '')})` : ''}${tried ? `, so we stopped after ${tried} ${tried === 1 ? 'try' : 'tries'}` : ''}. ${likelihood}`,
    })
  }
  return done({ email: null, status: 'not_found', greylisted: false, detail: `${domain}'s mail server rejected all ${tried} likely address formats.` })
}
