import { describe, expect, it } from 'vitest'
import { checkSenderHealth, newCriticalIssues, type HealthDeps } from './senderHealth'

// Spamhaus's permanent test entries, which every working lookup answers.
const CANARIES = {
  '2.0.0.127.zen.spamhaus.org': ['127.0.0.2'],
  'dbltest.com.dbl.spamhaus.org': ['127.0.1.2'],
}

function fakeDns(opts: {
  a?: Record<string, string[]>
  txt?: Record<string, string[]>
  mx?: Record<string, string[]>
  ptr?: Record<string, string[]>
  publicIp?: string | null
  failing?: string[]
}): HealthDeps {
  const a: Record<string, string[]> = { ...CANARIES, ...opts.a }
  return {
    resolve4: async (name) => {
      if (opts.failing?.some((z) => name.endsWith(z))) throw Object.assign(new Error('refused'), { code: 'EREFUSED' })
      return a[name] ?? []
    },
    resolveTxt: async (name) => (opts.txt?.[name] ?? []).map((r) => [r]),
    resolveMx: async (name) => opts.mx?.[name] ?? [],
    reverse: async (ip) => opts.ptr?.[ip] ?? [],
    publicIp: async () => (opts.publicIp === undefined ? '203.0.113.9' : opts.publicIp),
    now: () => Date.parse('2026-09-25T12:00:00Z'),
  }
}

/** A well set-up proxy: clean IP, matching reverse DNS, SPF on the FROM domain. */
const healthy = {
  a: { 'check.verify.example': ['198.51.100.7'] },
  ptr: { '198.51.100.7': ['check.verify.example.'] },
  txt: { 'verify.example': ['v=spf1 ip4:198.51.100.0/24 -all'] },
  mx: { 'verify.example': ['mx.verify.example'] },
}
const input = {
  targets: [{ label: 'eu-1', host: '198.51.100.7' }],
  fromEmail: 'check@verify.example',
  helloName: 'check.verify.example',
}

describe('checkSenderHealth', () => {
  it('reports a well set-up proxy as ok', async () => {
    const report = await checkSenderHealth(input, fakeDns(healthy))
    expect(report.level).toBe('ok')
    expect(report.ips[0]).toMatchObject({ ip: '198.51.100.7', ptr: 'check.verify.example', listedOn: [], level: 'ok' })
    expect(report.domain).toMatchObject({ domain: 'verify.example', level: 'ok' })
  })

  it('flags a home IP on the Spamhaus policy list, with the reason in plain words', async () => {
    const report = await checkSenderHealth(
      { targets: [{ label: 'This server', host: null }], fromEmail: null, helloName: null },
      fakeDns({ publicIp: '90.0.0.1', a: { '1.0.0.90.zen.spamhaus.org': ['127.0.0.10'] } }),
    )
    expect(report.level).toBe('critical')
    expect(report.ips[0].listedOn).toEqual(['Spamhaus'])
    expect(report.ips[0].issues.map((i) => i.code)).toEqual(['spamhaus-pbl', 'no-ptr'])
    expect(report.ips[0].issues[0].message).toMatch(/home or dynamic IP/)
    expect(report.issues.map((i) => i.code)).toEqual(['no-from', 'no-helo'])
  })

  it('treats a spam listing on a major list as critical and a minor list as a warning', async () => {
    const report = await checkSenderHealth(
      input,
      fakeDns({
        ...healthy,
        a: {
          ...healthy.a,
          '7.100.51.198.b.barracudacentral.org': ['127.0.0.2'],
          '7.100.51.198.psbl.surriel.com': ['127.0.0.2'],
        },
      }),
    )
    const ip = report.ips[0]
    expect(ip.listedOn).toEqual(['Barracuda', 'PSBL'])
    expect(ip.issues.map((i) => [i.code, i.level])).toEqual([
      ['listed-barracuda', 'critical'],
      ['listed-psbl', 'warning'],
    ])
    expect(report.level).toBe('critical')
  })

  it("doesn't read a Spamhaus refusal (public resolver) as clean", async () => {
    const report = await checkSenderHealth(
      input,
      fakeDns({
        ...healthy,
        a: { ...healthy.a, '2.0.0.127.zen.spamhaus.org': ['127.255.255.254'], 'dbltest.com.dbl.spamhaus.org': [] },
      }),
    )
    expect(report.ips[0].unchecked).toContain('Spamhaus')
    expect(report.ips[0].issues.map((i) => i.code)).toContain('spamhaus-unreachable')
    expect(report.domain?.unchecked).toContain('Spamhaus DBL')
    // An unreachable list is a note, not a problem with the IP.
    expect(report.level).toBe('ok')
  })

  it('lists a blocklist whose lookup fails as unchecked rather than clean', async () => {
    const report = await checkSenderHealth(input, fakeDns({ ...healthy, failing: ['b.barracudacentral.org'] }))
    expect(report.ips[0].unchecked).toEqual(['Barracuda'])
    expect(report.ips[0].listedOn).toEqual([])
  })

  it('warns when reverse DNS is missing, points elsewhere, or differs from the HELO name', async () => {
    const noPtr = await checkSenderHealth(input, fakeDns({ ...healthy, ptr: {} }))
    expect(noPtr.ips[0].issues.map((i) => i.code)).toEqual(['no-ptr'])
    expect(noPtr.ips[0].issues[0].fix).toContain('check.verify.example')

    const wrong = await checkSenderHealth(
      input,
      fakeDns({ ...healthy, ptr: { '198.51.100.7': ['static-7.hoster.net'] }, a: { 'static-7.hoster.net': ['198.51.100.99'] } }),
    )
    expect(wrong.ips[0].issues.map((i) => i.code)).toEqual(['ptr-mismatch', 'helo-mismatch'])
    expect(wrong.level).toBe('warning')
  })

  it('resolves a proxy given as a hostname', async () => {
    const report = await checkSenderHealth(
      { ...input, targets: [{ label: 'eu-1', host: 'check.verify.example' }] },
      fakeDns(healthy),
    )
    expect(report.ips[0]).toMatchObject({ host: 'check.verify.example', ip: '198.51.100.7', level: 'ok' })
  })

  it("marks an IP it can't find as unknown", async () => {
    const report = await checkSenderHealth(
      { ...input, targets: [{ label: 'This server', host: null }] },
      fakeDns({ ...healthy, publicIp: null }),
    )
    expect(report.ips[0]).toMatchObject({ ip: null, level: 'unknown' })
  })

  describe('FROM domain', () => {
    it('flags a domain on the Spamhaus DBL', async () => {
      const report = await checkSenderHealth(
        input,
        fakeDns({ ...healthy, a: { ...healthy.a, 'verify.example.dbl.spamhaus.org': ['127.0.1.2'] } }),
      )
      expect(report.domain).toMatchObject({ listedOn: ['Spamhaus DBL'], level: 'critical' })
    })

    it('warns about a missing SPF record, with the record to add', async () => {
      const report = await checkSenderHealth(input, fakeDns({ ...healthy, txt: {} }))
      const issue = report.domain!.issues.find((i) => i.code === 'no-spf')!
      expect(issue.fix).toContain('v=spf1 ip4:198.51.100.7 ~all')
    })

    it("warns when SPF doesn't cover a verifying IP", async () => {
      const report = await checkSenderHealth(
        input,
        fakeDns({ ...healthy, txt: { 'verify.example': ['v=spf1 ip4:192.0.2.1 -all'] } }),
      )
      expect(report.domain!.issues.map((i) => i.code)).toEqual(['spf-198.51.100.7'])
    })

    it('follows include, a, mx and redirect in SPF', async () => {
      const viaInclude = fakeDns({
        ...healthy,
        txt: { 'verify.example': ['v=spf1 include:_spf.hoster.net ~all'], '_spf.hoster.net': ['v=spf1 ip4:198.51.100.7 -all'] },
      })
      expect((await checkSenderHealth(input, viaInclude)).domain!.issues).toEqual([])

      const viaA = fakeDns({ ...healthy, txt: { 'verify.example': ['v=spf1 a:check.verify.example -all'] } })
      expect((await checkSenderHealth(input, viaA)).domain!.issues).toEqual([])

      const viaMx = fakeDns({
        ...healthy,
        a: { ...healthy.a, 'mx.verify.example': ['198.51.100.7'] },
        txt: { 'verify.example': ['v=spf1 mx -all'] },
      })
      expect((await checkSenderHealth(input, viaMx)).domain!.issues).toEqual([])

      const viaRedirect = fakeDns({
        ...healthy,
        txt: { 'verify.example': ['v=spf1 redirect=_spf.verify.example'], '_spf.verify.example': ['v=spf1 ip4:198.51.100.7 -all'] },
      })
      expect((await checkSenderHealth(input, viaRedirect)).domain!.issues).toEqual([])
    })

    it('does not count a softfail or neutral match as allowed', async () => {
      const report = await checkSenderHealth(input, fakeDns({ ...healthy, txt: { 'verify.example': ['v=spf1 ~all'] } }))
      expect(report.domain!.issues.map((i) => i.code)).toEqual(['spf-198.51.100.7'])
    })

    it('gives up on SPF records that need more than 10 lookups', async () => {
      const txt: Record<string, string[]> = {}
      for (let i = 0; i < 12; i++) txt[i === 0 ? 'verify.example' : `l${i}.example`] = [`v=spf1 include:l${i + 1}.example -all`]
      const report = await checkSenderHealth(input, fakeDns({ ...healthy, txt }))
      expect(report.domain!.issues.map((i) => i.code)).toEqual(['spf-error'])
    })

    it('warns when the domain has no MX', async () => {
      const report = await checkSenderHealth(input, fakeDns({ ...healthy, mx: {} }))
      expect(report.domain!.issues.map((i) => i.code)).toEqual(['no-mx'])
    })
  })
})

describe('newCriticalIssues', () => {
  it('returns only critical problems that are new since the last run', async () => {
    const clean = await checkSenderHealth(input, fakeDns(healthy))
    const listed = await checkSenderHealth(
      input,
      fakeDns({ ...healthy, a: { ...healthy.a, '7.100.51.198.bl.spamcop.net': ['127.0.0.2'] } }),
    )
    expect(newCriticalIssues(clean, listed)).toEqual(['eu-1 (198.51.100.7): Listed on SpamCop. Mail servers that use it will refuse checks from this IP.'])
    // Still listed six hours later: no second alert.
    expect(newCriticalIssues(listed, listed)).toEqual([])
    // Warnings never alert.
    const warning = await checkSenderHealth(input, fakeDns({ ...healthy, ptr: {} }))
    expect(newCriticalIssues(clean, warning)).toEqual([])
    // First run ever: an existing listing is news.
    expect(newCriticalIssues(null, listed)).toHaveLength(1)
  })
})
