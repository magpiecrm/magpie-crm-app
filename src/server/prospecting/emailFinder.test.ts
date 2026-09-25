import { describe, expect, it, vi } from 'vitest'
import type { EmailDomainRecord } from '../db'
import { findEmail, type FinderDeps } from './emailFinder'
import type { Reachability } from './reacher'

const NOW = Date.parse('2026-09-01T00:00:00Z')

/**
 * Fake finder deps. `mailbox` decides each address's Reacher verdict; random
 * catch-all probes fall through to `probe`.
 */
function setup(opts: {
  mailbox?: Record<string, Reachability>
  probe?: Reachability
  mx?: string[] | Error
  verifier?: boolean
  domain?: Partial<EmailDomainRecord>
  smtpMessage?: Record<string, string>
}) {
  const domains = new Map<string, EmailDomainRecord>()
  if (opts.domain) {
    domains.set('acme.com', {
      domain: 'acme.com', pattern: null, pattern_confidence: 0, pattern_verified_at: null, catch_all: null,
      catch_all_checked_at: null, mx_provider: null, accepts_mail: null, mx_checked_at: null, last_used_at: '',
      ...opts.domain,
    })
  }
  const checked: string[] = []
  const check = vi.fn(async (email: string) => {
    checked.push(email)
    const verdict = opts.mailbox?.[email] ?? (email.split('@')[0].length === 18 ? opts.probe ?? 'invalid' : 'invalid')
    const message = opts.smtpMessage?.[email]
    return {
      reachability: verdict,
      isCatchAll: null,
      outcome: message?.startsWith('4') ? ('greylisted' as const) : ('ok' as const),
    }
  })
  const deps: FinderDeps = {
    getDomain: (d) => domains.get(d) ?? null,
    updateDomain: (d, patch) => {
      const rec = domains.get(d) ?? {
        domain: d, pattern: null, pattern_confidence: 0, pattern_verified_at: null, catch_all: null,
        catch_all_checked_at: null, mx_provider: null, accepts_mail: null, mx_checked_at: null, last_used_at: '',
      }
      Object.assign(rec, patch)
      domains.set(d, rec)
      return rec
    },
    resolveMx: async () => {
      if (opts.mx instanceof Error) throw opts.mx
      return opts.mx ?? ['aspmx.l.google.com']
    },
    verifier: opts.verifier === false ? null : {
      acquire: async () => ({ proxy: null, report: () => {} }),
      check: (email) => check(email),
    },
    now: () => NOW,
  }
  // Candidate checks, excluding the random catch-all probe.
  const candidateChecks = () => checked.filter((e) => e.split('@')[0].length !== 18)
  return { deps, domains, checked, candidateChecks }
}

const jane = { firstName: 'Jane', lastName: 'Smith' }

describe('findEmail', () => {
  it('stops at the first safe candidate and learns only the pattern', async () => {
    const { deps, domains, candidateChecks } = setup({ mailbox: { 'jsmith@acme.com': 'safe' } })
    const result = await findEmail(jane, 'acme.com', deps)
    expect(result).toEqual({ email: 'jsmith@acme.com', status: 'verified', greylisted: false })
    expect(candidateChecks()).toEqual(['jane.smith@acme.com', 'jsmith@acme.com'])

    const rec = domains.get('acme.com')!
    expect(rec.pattern).toBe('{f}{last}')
    expect(rec.pattern_confidence).toBeGreaterThanOrEqual(0.8)
    expect(rec.catch_all).toBe(false)
    expect(rec.mx_provider).toBe('google')
    // Nothing personal on the domain record.
    expect(JSON.stringify(rec)).not.toMatch(/jane|smith/)
  })

  it('uses a trusted learned pattern with a single check', async () => {
    const { deps, candidateChecks } = setup({
      mailbox: { 'bob.jones@acme.com': 'invalid', 'bjones@acme.com': 'safe' },
      domain: {
        pattern: '{f}{last}', pattern_confidence: 0.9, pattern_verified_at: new Date(NOW - 86_400_000).toISOString(),
        catch_all: false, catch_all_checked_at: new Date(NOW).toISOString(), accepts_mail: true, mx_checked_at: new Date(NOW).toISOString(),
      },
    })
    const result = await findEmail({ firstName: 'Bob', lastName: 'Jones' }, 'acme.com', deps)
    expect(result.status).toBe('verified')
    expect(candidateChecks()).toEqual(['bjones@acme.com'])
  })

  it('ignores a learned pattern older than 90 days', async () => {
    const { deps, candidateChecks } = setup({
      mailbox: { 'jane.smith@acme.com': 'safe' },
      domain: {
        pattern: '{f}{last}', pattern_confidence: 0.9, pattern_verified_at: new Date(NOW - 100 * 86_400_000).toISOString(),
        catch_all: false, catch_all_checked_at: new Date(NOW).toISOString(), accepts_mail: true, mx_checked_at: new Date(NOW).toISOString(),
      },
    })
    await findEmail(jane, 'acme.com', deps)
    expect(candidateChecks()[0]).toBe('jane.smith@acme.com')
  })

  it('returns the best guess as catch_all_likely without checking candidates', async () => {
    const { deps, candidateChecks, domains } = setup({ probe: 'safe' })
    const result = await findEmail(jane, 'acme.com', deps)
    expect(result).toEqual({ email: 'jane.smith@acme.com', status: 'catch_all_likely', greylisted: false })
    expect(candidateChecks()).toEqual([])
    expect(domains.get('acme.com')!.catch_all).toBe(true)
    expect(domains.get('acme.com')!.pattern).toBeNull()
  })

  it('probes catch-all once per domain even for concurrent lookups', async () => {
    const { deps, checked } = setup({ mailbox: { 'jane.smith@acme.com': 'safe', 'bob.jones@acme.com': 'safe' } })
    await Promise.all([findEmail(jane, 'acme.com', deps), findEmail({ firstName: 'Bob', lastName: 'Jones' }, 'acme.com', deps)])
    expect(checked.filter((e) => e.split('@')[0].length === 18)).toHaveLength(1)
  })

  it('reports not_found for a domain with no MX, without any checks', async () => {
    const { deps, checked } = setup({ mx: [] })
    expect(await findEmail(jane, 'acme.com', deps)).toEqual({ email: null, status: 'not_found', greylisted: false })
    expect(checked).toEqual([])
  })

  it('carries on when the MX lookup itself fails', async () => {
    const { deps } = setup({ mx: new Error('ETIMEOUT'), mailbox: { 'jane.smith@acme.com': 'safe' } })
    expect((await findEmail(jane, 'acme.com', deps)).status).toBe('verified')
  })

  it('returns an unverified best guess without Reacher', async () => {
    const { deps } = setup({ verifier: false })
    expect(await findEmail(jane, 'acme.com', deps)).toEqual({ email: 'jane.smith@acme.com', status: 'unverified', greylisted: false })
  })

  it('falls back to the first risky candidate', async () => {
    const { deps } = setup({ mailbox: { 'jane@acme.com': 'risky' } })
    expect(await findEmail(jane, 'acme.com', deps)).toEqual({ email: 'jane@acme.com', status: 'risky', greylisted: false })
  })

  it('reports not_found when every candidate is rejected', async () => {
    const { deps, candidateChecks } = setup({})
    expect((await findEmail(jane, 'acme.com', deps)).status).toBe('not_found')
    expect(candidateChecks().length).toBeLessThanOrEqual(6)
  })

  it('flags greylisting so the caller can retry', async () => {
    const { deps } = setup({
      mailbox: { 'jane.smith@acme.com': 'unknown' },
      smtpMessage: { 'jane.smith@acme.com': '451 greylisted' },
    })
    expect(await findEmail(jane, 'acme.com', deps)).toEqual({ email: 'jane.smith@acme.com', status: 'unverified', greylisted: true })
  })
})
