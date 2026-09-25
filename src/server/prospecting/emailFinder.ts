// Finds one work email for one person at one domain.
//
//   1. MX lookup (cached per domain): no MX means the domain takes no mail.
//   2. Catch-all probe (once per domain, cached 90 days): a random address is
//      checked; if the server accepts it, nothing on that domain can be
//      verified and the best-ranked guess is returned as `catch_all_likely`.
//   3. Candidates in likelihood order — a trusted learned pattern first — are
//      checked through Reacher until the first `safe`.
//   4. A `safe` result on a non-catch-all domain teaches the domain its
//      pattern. Only the pattern is stored, never the name or address.
//
// Without Reacher configured, steps 2-4 are skipped and the top candidate is
// returned as `unverified`.

import crypto from 'crypto'
import type { EmailDomainRecord } from '../db'
import { generateCandidates, type Candidate } from './patterns'
import { providerFromMx, type Lease, type MailProvider } from './proxyRouter'
import type { CheckResult } from './reacher'
import type { EmailStatus } from './types'

const DAY = 86_400_000
/** Learned patterns and catch-all status are re-checked after this long. */
const DOMAIN_REFRESH_MS = 90 * DAY
const MX_REFRESH_MS = 30 * DAY
/** A pattern at or above this confidence is tried first, on its own. */
const TRUSTED_CONFIDENCE = 0.8
/**
 * Reacher opens a fresh SMTP session per check, so the practical cap on RCPT
 * TO probes against one domain is checks per person, plus the per-provider
 * rate limits in the proxy router.
 */
const MAX_CHECKS_PER_PERSON = 6

export interface FinderDeps {
  getDomain(domain: string): EmailDomainRecord | null
  updateDomain(domain: string, patch: Partial<Omit<EmailDomainRecord, 'domain'>>): EmailDomainRecord
  /** MX hostnames; `[]` when the domain has none. Throws on lookup failure. */
  resolveMx(domain: string): Promise<string[]>
  /** Null when Reacher isn't configured. */
  verifier: {
    acquire(provider: MailProvider): Promise<Lease>
    check(email: string, lease: Lease): Promise<CheckResult>
  } | null
  now(): number
}

export interface FindResult {
  email: string | null
  status: EmailStatus
  /** At least one check was greylisted; worth retrying later for a better answer. */
  greylisted: boolean
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

    if (deps.verifier && rec.accepts_mail !== false && isStale(rec.catch_all_checked_at, DOMAIN_REFRESH_MS, now)) {
      const probe = `${crypto.randomBytes(9).toString('hex')}@${domain}`
      const lease = await deps.verifier.acquire(rec.mx_provider ?? 'other')
      const result = await deps.verifier.check(probe, lease)
      lease.report(result.outcome)
      const catchAll =
        result.isCatchAll ?? (result.reachability === 'safe' || result.reachability === 'risky' ? true : result.reachability === 'invalid' ? false : null)
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
): Promise<FindResult> {
  const domain = rawDomain.toLowerCase().trim()
  const rec = await prepareDomain(domain, deps)
  if (rec.accepts_mail === false) return { email: null, status: 'not_found', greylisted: false }

  const known = trustedPattern(rec, deps.now())
  const candidates: Candidate[] = generateCandidates(person.firstName, person.lastName, domain, {
    knownPattern: known,
    max: MAX_CHECKS_PER_PERSON,
  })
  if (candidates.length === 0) return { email: null, status: 'not_found', greylisted: false }

  if (rec.catch_all) return { email: candidates[0].email, status: 'catch_all_likely', greylisted: false }
  if (!deps.verifier) return { email: candidates[0].email, status: 'unverified', greylisted: false }

  let firstRisky: string | null = null
  let greylisted = false
  let anyDefinite = false

  for (const candidate of candidates) {
    const lease = await deps.verifier.acquire(rec.mx_provider ?? 'other')
    const result = await deps.verifier.check(candidate.email, lease)
    lease.report(result.outcome)

    if (result.isCatchAll) {
      // The probe missed it (or it was never run); record and stop guessing.
      deps.updateDomain(domain, { catch_all: true, catch_all_checked_at: new Date(deps.now()).toISOString() })
      return { email: candidates[0].email, status: 'catch_all_likely', greylisted: false }
    }

    if (result.reachability === 'safe') {
      learnPattern(domain, candidate.pattern, deps)
      return { email: candidate.email, status: 'verified', greylisted: false }
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
  }

  if (firstRisky) return { email: firstRisky, status: 'risky', greylisted }
  // Nothing definite came back (greylisting, timeouts): keep the best guess.
  if (!anyDefinite || greylisted) return { email: candidates[0].email, status: 'unverified', greylisted }
  return { email: null, status: 'not_found', greylisted: false }
}
