import { describe, expect, it, vi } from 'vitest'
import type { EmailDomainRecord } from '../db'
import { findEmail, isKnownCatchAll, type FinderDeps } from './emailFinder'
import type { Reachability } from './reacher'

const NOW = Date.parse('2026-09-01T00:00:00Z')

/** The finder's made-up catch-all probes: hex noise, then a made-up `first.last`. */
const isProbe = (email: string) => {
  const local = email.split('@')[0]
  return /^[0-9a-f]{18}$/.test(local) || /^([bcdfghklmnprstvz][aeiou]){3}[bcdfghklmnprstvz]\.([bcdfghklmnprstvz][aeiou]){3}[bcdfghklmnprstvz]$/.test(local)
}

/**
 * Fake finder deps. `mailbox` decides the verification server's verdict on each address; the
 * made-up catch-all probes fall through to `probe` (a list: one verdict per probe, in order, the
 * last repeating).
 */
function setup(opts: {
  mailbox?: Record<string, Reachability>
  probe?: Reachability | Reachability[]
  /** SMTP message on every probe, e.g. a greylisting reply. */
  probeMessage?: string
  mx?: string[] | Error
  /** Per-domain MX hosts; domains not listed have none. Overrides `mx`. */
  mxByDomain?: Record<string, string[]>
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
  const probes = [opts.probe ?? 'invalid'].flat()
  let probeCount = 0
  const check = vi.fn(async (email: string) => {
    checked.push(email)
    const probe = isProbe(email)
    const verdict = opts.mailbox?.[email] ?? (probe ? probes[Math.min(probeCount++, probes.length - 1)] : 'invalid')
    const message = probe ? opts.probeMessage : opts.smtpMessage?.[email]
    return {
      reachability: verdict,
      isCatchAll: null,
      outcome: message?.startsWith('4') ? ('greylisted' as const) : message?.includes('spamhaus') ? ('sender_rejected' as const) : ('ok' as const),
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
    resolveMx: async (d) => {
      if (opts.mxByDomain) return opts.mxByDomain[d] ?? []
      if (opts.mx instanceof Error) throw opts.mx
      return opts.mx ?? ['aspmx.l.google.com']
    },
    verifier: opts.verifier === false ? null : {
      acquire: async () => ({ proxy: null, report: () => {} }),
      check: (email) => check(email),
    },
    now: () => NOW,
  }
  // Candidate checks, excluding the made-up catch-all probes.
  const candidateChecks = () => checked.filter((e) => !isProbe(e))
  const probeChecks = () => checked.filter(isProbe)
  return { deps, domains, checked, candidateChecks, probeChecks }
}

const jane = { firstName: 'Jane', lastName: 'Smith' }

describe('findEmail', () => {
  it('stops at the first safe candidate and learns only the pattern', async () => {
    const { deps, domains, candidateChecks } = setup({ mailbox: { 'jsmith@acme.com': 'safe' } })
    const result = await findEmail(jane, 'acme.com', deps)
    expect(result).toEqual({ email: 'jsmith@acme.com', status: 'verified', outcome: 'verified', greylisted: false })
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
    expect(result).toMatchObject({ email: 'jane.smith@acme.com', status: 'catch_all_likely', outcome: 'catchAll', greylisted: false })
    expect(result.detail).toMatch(/acme\.com accepts every address/)
    expect(candidateChecks()).toEqual([])
    expect(domains.get('acme.com')!.catch_all).toBe(true)
    expect(domains.get('acme.com')!.pattern).toBeNull()
  })

  it('confirms a catch-all with a second, name-shaped probe before trusting it', async () => {
    const { deps, domains, probeChecks } = setup({ probe: 'safe' })
    await findEmail(jane, 'acme.com', deps)
    expect(probeChecks()).toHaveLength(2)
    expect(probeChecks()[1]).toMatch(/^[a-z]{7}\.[a-z]{7}@acme\.com$/)
    expect(domains.get('acme.com')).toMatchObject({ catch_all: true, catch_all_source: 'probe_accepted', catch_all_confirmed: true })
  })

  it('checks people normally when the second probe is turned away', async () => {
    const { deps, domains, candidateChecks } = setup({ probe: ['safe', 'invalid'], mailbox: { 'jsmith@acme.com': 'safe' } })
    const result = await findEmail(jane, 'acme.com', deps)
    expect(result).toMatchObject({ email: 'jsmith@acme.com', status: 'verified' })
    expect(candidateChecks()).toEqual(['jane.smith@acme.com', 'jsmith@acme.com'])
    expect(domains.get('acme.com')!.catch_all).toBe(false)
  })

  it('keeps an unconfirmed catch-all when the second probe gets no answer', async () => {
    const { deps, domains } = setup({ probe: ['safe', 'unknown'] })
    expect((await findEmail(jane, 'acme.com', deps)).status).toBe('catch_all_likely')
    expect(domains.get('acme.com')).toMatchObject({ catch_all: true, catch_all_confirmed: false })
  })

  it('does not take a risky answer on a made-up address as catch-all', async () => {
    const { deps, domains, candidateChecks } = setup({ probe: 'risky', mailbox: { 'jane.smith@acme.com': 'safe' } })
    const result = await findEmail(jane, 'acme.com', deps)
    expect(result.status).toBe('verified')
    expect(candidateChecks()).toEqual(['jane.smith@acme.com'])
    const rec = domains.get('acme.com')!
    expect(rec.catch_all).toBeNull()
    // Inconclusive: tried again tomorrow, not on every lookup.
    expect(rec.catch_all_recheck_at).toBe(new Date(NOW + 86_400_000).toISOString())
  })

  it('repeats a greylisted catch-all test after the greylist window, not on every lookup', async () => {
    const { deps, probeChecks } = setup({ probe: 'unknown', probeMessage: '451 4.7.1 greylisted, try again later' })
    let now = NOW
    deps.now = () => now
    await findEmail(jane, 'acme.com', deps)
    await findEmail(jane, 'acme.com', deps)
    expect(probeChecks()).toHaveLength(1)
    now += 5 * 60_000
    await findEmail(jane, 'acme.com', deps)
    expect(probeChecks()).toHaveLength(2)
  })

  it('re-tests an unconfirmed catch-all after 30 days, a confirmed one after 90', async () => {
    const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()
    const known = { accepts_mail: true, mx_provider: 'google' as const, mx_family: 'google' as const, mx_checked_at: daysAgo(1) }
    const legacy = setup({ probe: 'invalid', domain: { ...known, catch_all: true, catch_all_checked_at: daysAgo(40) } })
    await findEmail(jane, 'acme.com', legacy.deps)
    expect(legacy.probeChecks()).toHaveLength(1)
    expect(legacy.domains.get('acme.com')!.catch_all).toBe(false)

    const confirmed = setup({ domain: { ...known, catch_all: true, catch_all_confirmed: true, catch_all_checked_at: daysAgo(40) } })
    expect((await findEmail(jane, 'acme.com', confirmed.deps)).status).toBe('catch_all_likely')
    expect(confirmed.checked).toEqual([])
  })

  it('names the security gateway that makes a company accept every address', async () => {
    const { deps, domains } = setup({ probe: 'safe', mx: ['eu-smtp-inbound-1.mimecast.com'] })
    const result = await findEmail(jane, 'acme.com', deps)
    expect(result.reason).toBe("acme.com's mail is filtered by Mimecast, which accepts every address, so none can be confirmed.")
    expect(domains.get('acme.com')!.mx_family).toBe('mimecast')
  })

  it('probes catch-all once per domain even for concurrent lookups', async () => {
    const { deps, checked } = setup({ mailbox: { 'jane.smith@acme.com': 'safe', 'bob.jones@acme.com': 'safe' } })
    await Promise.all([findEmail(jane, 'acme.com', deps), findEmail({ firstName: 'Bob', lastName: 'Jones' }, 'acme.com', deps)])
    expect(checked.filter(isProbe)).toHaveLength(1)
  })

  it('falls back from a website subdomain that takes no mail to its parent domain', async () => {
    const { deps, candidateChecks } = setup({
      mxByDomain: { 'acme.com': ['aspmx.l.google.com'] },
      mailbox: { 'jane.smith@acme.com': 'safe' },
    })
    const result = await findEmail(jane, 'careers.acme.com', deps)
    expect(result).toMatchObject({ email: 'jane.smith@acme.com', status: 'verified' })
    expect(candidateChecks()).toEqual(['jane.smith@acme.com'])
  })

  it('offers a domain from the company DNS when the website domain takes no email', async () => {
    const { deps } = setup({ mxByDomain: {} })
    deps.suggestMailDomain = async (d) => (d === 'jlr.com' ? 'jaguarlandrover.com' : null)
    const result = await findEmail(jane, 'jlr.com', deps)
    expect(result).toMatchObject({ status: 'not_found', domainProblem: true, suggestedDomain: 'jaguarlandrover.com' })
    expect(result.detail).toMatch(/run from jaguarlandrover\.com, which does/)
  })

  it('says how likely a best guess is, using company size', async () => {
    const { deps } = setup({ probe: 'safe' })
    const result = await findEmail(jane, 'acme.com', deps, { headcount: 20000 })
    expect(result.status).toBe('catch_all_likely')
    expect(result.detail).toMatch(/About 74% of people at companies of 10,000\+ people use this format/)
  })

  it('never falls back to a registry like co.uk', async () => {
    const { deps } = setup({ mxByDomain: { 'co.uk': ['mx.example'] } })
    const result = await findEmail(jane, 'acme.co.uk', deps)
    expect(result).toMatchObject({ status: 'not_found', domainProblem: true })
  })

  it('does not guess when LinkedIn hides the surname', async () => {
    const { deps, checked } = setup({})
    const result = await findEmail({ firstName: 'Andy', lastName: 'C.' }, 'acme.com', deps)
    expect(result).toMatchObject({ email: null, status: 'not_found', outcome: 'hiddenSurname', detail: expect.stringMatching(/surname is hidden/) })
    expect(checked).toEqual([])
  })

  it('stops after two unknowns in a row instead of spending all six checks', async () => {
    const unknown = Object.fromEntries(['jane.smith', 'jsmith', 'jane', 'janesmith'].map((l) => [`${l}@acme.com`, 'unknown' as const]))
    const { deps, candidateChecks } = setup({ mailbox: unknown })
    const result = await findEmail(jane, 'acme.com', deps)
    expect(candidateChecks()).toEqual(['jane.smith@acme.com', 'jsmith@acme.com'])
    expect(result).toMatchObject({ email: 'jane.smith@acme.com', status: 'unverified', outcome: 'noAnswer', detail: expect.stringMatching(/stopped after 2 tries/) })
  })

  it('says when our sender domain is what gets checks refused', async () => {
    const { deps } = setup({
      mailbox: { 'jane.smith@acme.com': 'unknown', 'jsmith@acme.com': 'unknown' },
      smtpMessage: { 'jane.smith@acme.com': '554 listed at spamhaus dbl', 'jsmith@acme.com': '554 listed at spamhaus dbl' },
    })
    expect(await findEmail(jane, 'acme.com', deps)).toMatchObject({ status: 'unverified', outcome: 'blocked' })
  })

  it('reports not_found for a domain with no MX, without any checks', async () => {
    const { deps, checked } = setup({ mx: [] })
    expect(await findEmail(jane, 'acme.com', deps)).toEqual({
      email: null, status: 'not_found', outcome: 'noMail', greylisted: false, detail: "acme.com doesn't receive email, so there's nothing to check.", domainProblem: true,
    })
    expect(checked).toEqual([])
  })

  it('carries on when the MX lookup itself fails', async () => {
    const { deps } = setup({ mx: new Error('ETIMEOUT'), mailbox: { 'jane.smith@acme.com': 'safe' } })
    expect((await findEmail(jane, 'acme.com', deps)).status).toBe('verified')
  })

  it('returns an unverified best guess without the verification server', async () => {
    const { deps } = setup({ verifier: false })
    expect(await findEmail(jane, 'acme.com', deps)).toMatchObject({
      email: 'jane.smith@acme.com', status: 'unverified', outcome: 'unchecked', greylisted: false, detail: expect.stringMatching(/verification is off/),
    })
  })

  it('falls back to the first risky candidate', async () => {
    const { deps } = setup({ mailbox: { 'jane@acme.com': 'risky' } })
    expect(await findEmail(jane, 'acme.com', deps)).toMatchObject({ email: 'jane@acme.com', status: 'risky', outcome: 'risky', greylisted: false })
  })

  it('reports not_found when every candidate is rejected', async () => {
    const { deps, candidateChecks } = setup({})
    const result = await findEmail(jane, 'acme.com', deps)
    expect(result).toMatchObject({ status: 'not_found', outcome: 'rejected' })
    expect(result.detail).toBe("acme.com's mail server rejected all 6 likely address formats.")
    expect(candidateChecks().length).toBeLessThanOrEqual(6)
  })

  it('flags greylisting so the caller can retry', async () => {
    const { deps } = setup({
      mailbox: { 'jane.smith@acme.com': 'unknown' },
      smtpMessage: { 'jane.smith@acme.com': '451 greylisted' },
    })
    expect(await findEmail(jane, 'acme.com', deps)).toMatchObject({
      email: 'jane.smith@acme.com', status: 'unverified', outcome: 'greylisted', greylisted: true, detail: expect.stringMatching(/try again later/),
    })
  })
})

describe('isKnownCatchAll', () => {
  const rec = (patch: Partial<EmailDomainRecord>): EmailDomainRecord => ({
    domain: 'x', pattern: null, pattern_confidence: 0, pattern_verified_at: null, catch_all: null, catch_all_checked_at: null,
    mx_provider: null, accepts_mail: true, mx_checked_at: null, last_used_at: '', ...patch,
  })
  const fresh = new Date(NOW - 86_400_000).toISOString()
  const lookup = (records: Record<string, EmailDomainRecord>) => (d: string) => records[d] ?? null

  it('is true only for a fresh catch-all result', () => {
    expect(isKnownCatchAll('acme.com', lookup({ 'acme.com': rec({ catch_all: true, catch_all_checked_at: fresh }) }), NOW)).toBe(true)
    expect(isKnownCatchAll('acme.com', lookup({ 'acme.com': rec({ catch_all: false, catch_all_checked_at: fresh }) }), NOW)).toBe(false)
    expect(isKnownCatchAll('acme.com', lookup({ 'acme.com': rec({ catch_all: true, catch_all_checked_at: '2025-01-01T00:00:00Z' }) }), NOW)).toBe(false)
    // Remembered 30 days from one session, 90 once confirmed, 180 behind a gateway.
    const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()
    const known = (days: number, patch: Partial<EmailDomainRecord> = {}) =>
      isKnownCatchAll('acme.com', lookup({ 'acme.com': rec({ catch_all: true, catch_all_checked_at: daysAgo(days), ...patch }) }), NOW)
    expect(known(20)).toBe(true)
    expect(known(40)).toBe(false)
    expect(known(80, { catch_all_confirmed: true })).toBe(true)
    expect(known(120, { catch_all_confirmed: true })).toBe(false)
    expect(known(120, { catch_all_confirmed: true, mx_family: 'proofpoint' })).toBe(true)
    expect(known(200, { catch_all_confirmed: true, mx_family: 'proofpoint' })).toBe(false)
    // Never checked: unknown, so not hidden.
    expect(isKnownCatchAll('acme.com', lookup({}), NOW)).toBe(false)
  })

  it('follows a mail-less subdomain up to the parent the finder would use', () => {
    const records = {
      'careers.acme.com': rec({ accepts_mail: false }),
      'acme.com': rec({ catch_all: true, catch_all_checked_at: fresh }),
    }
    expect(isKnownCatchAll('careers.acme.com', lookup(records), NOW)).toBe(true)
    // A subdomain that takes mail itself is judged on its own.
    expect(isKnownCatchAll('uk.acme.com', lookup({ ...records, 'uk.acme.com': rec({ accepts_mail: true }) }), NOW)).toBe(false)
  })

  it('never walks up to a public suffix like co.uk', () => {
    const records = { 'acme.co.uk': rec({ accepts_mail: false }), 'co.uk': rec({ catch_all: true, catch_all_checked_at: fresh }) }
    expect(isKnownCatchAll('acme.co.uk', lookup(records), NOW)).toBe(false)
  })
})

describe('findEmail retries through another IP when a company refuses one', () => {
  const refusing = async (labels: string[]) => {
    const { ProxyRouter } = await import('./proxyRouter')
    const router = new ProxyRouter(
      labels.map((label) => ({ host: `${label}.example`, port: 1080, label })),
      { sleep: async () => {} },
    )
    const used: string[] = []
    const { deps } = setup({})
    deps.verifier = {
      acquire: (provider, domain) => router.acquire(provider, domain),
      // IP "a" is refused at the greeting; "b" gets real answers.
      check: async (email, lease) => {
        used.push(lease.proxy?.label ?? 'direct')
        if (lease.proxy?.label === 'a') return { reachability: 'unknown', isCatchAll: null, outcome: 'unreachable', detail: "it doesn't accept connections from the verification server" }
        return { reachability: email.startsWith('jane.smith@') ? 'safe' : 'invalid', isCatchAll: false, outcome: 'ok' }
      },
    }
    return { deps, used }
  }

  it('checks through the other IP, and keeps later checks at that company off the refused one', async () => {
    const { deps, used } = await refusing(['a', 'b'])
    const result = await findEmail(jane, 'acme.com', deps)
    expect(result).toMatchObject({ email: 'jane.smith@acme.com', status: 'verified' })
    // Catch-all probe: refused by a, retried on b. Then the guess goes straight to b.
    expect(used).toEqual(['a', 'b', 'b'])
  })

  it('stops without spending more checks once every IP has refused', async () => {
    const { deps, used } = await refusing(['a'])
    const result = await findEmail(jane, 'acme.com', deps)
    expect(result).toMatchObject({ status: 'unverified', outcome: 'refused' })
    expect(result.detail).toMatch(/refuses connections from every verification IP/)
    expect(result.detail).not.toMatch(/stopped after/)
    // Only the catch-all probe was sent; no guess was checked.
    expect(used).toEqual(['a'])
  })
})
