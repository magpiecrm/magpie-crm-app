import { describe, expect, it, vi } from 'vitest'
import { ProxyRouter, parseProxyConfig, providerFromMx } from './proxyRouter'
import { classifySmtpOutcome } from './reacher'

// A controllable clock: `sleep` advances time instead of waiting.
function clock() {
  let now = 1_000_000
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms
    },
    advance: (ms: number) => {
      now += ms
    },
  }
}

const proxies = [
  { host: 'a.example', port: 1080, label: 'a' },
  { host: 'b.example', port: 1080, label: 'b' },
]

describe('ProxyRouter', () => {
  it('connects directly when no proxies are configured', async () => {
    const lease = await new ProxyRouter([]).acquire('other')
    expect(lease.proxy).toBeNull()
  })

  it('round-robins across proxies', async () => {
    const r = new ProxyRouter(proxies, clock())
    const labels = []
    for (let i = 0; i < 4; i++) labels.push((await r.acquire('other')).proxy?.label)
    expect(labels).toEqual(['a', 'b', 'a', 'b'])
  })

  it('waits for the per-proxy window instead of exceeding it', async () => {
    const c = clock()
    const r = new ProxyRouter([proxies[0]], { ...c, perProxyPerMinute: 2 })
    const start = c.now()
    await r.acquire('other')
    await r.acquire('other')
    await r.acquire('other')
    expect(c.now() - start).toBeGreaterThanOrEqual(60_000)
  })

  it('applies stricter per-provider limits per IP, so each proxy adds capacity', async () => {
    const c = clock()
    const one = new ProxyRouter([proxies[0]], { ...c, perProviderPerMinute: { microsoft: 1, google: 10, other: 20 }, maxWaitMs: 5_000 })
    await one.acquire('microsoft')
    await expect(one.acquire('microsoft')).rejects.toThrow(/per-minute limit/)
    // Other providers are unaffected.
    await expect(one.acquire('other')).resolves.toBeTruthy()

    const two = new ProxyRouter(proxies, { ...c, perProviderPerMinute: { microsoft: 1, google: 10, other: 20 }, maxWaitMs: 5_000 })
    const labels = [(await two.acquire('microsoft')).proxy?.label, (await two.acquire('microsoft')).proxy?.label]
    expect(labels.sort()).toEqual(['a', 'b'])
    await expect(two.acquire('microsoft')).rejects.toThrow(/per-minute limit/)
  })

  it('benches a proxy after repeated blocks, and skips it', async () => {
    const c = clock()
    const r = new ProxyRouter(proxies, { ...c, benchAfter: 2, benchMs: 60_000 })
    for (let i = 0; i < 2; i++) {
      const lease = await r.acquire('other')
      if (lease.proxy?.label === 'a') lease.report('blocked')
      else lease.report('ok')
      const next = await r.acquire('other')
      if (next.proxy?.label === 'a') next.report('blocked')
      else next.report('ok')
    }
    const health = r.health()
    expect(health.find((h) => h.label === 'a')?.benchedUntil).not.toBeNull()
    const labels = new Set<string | undefined>()
    for (let i = 0; i < 4; i++) labels.add((await r.acquire('other')).proxy?.label)
    expect(labels).toEqual(new Set(['b']))

    c.advance(61_000)
    expect(r.health().find((h) => h.label === 'a')?.benchedUntil).toBeNull()
  })

  it('does not bench on greylisting', async () => {
    const r = new ProxyRouter([proxies[0]], { ...clock(), benchAfter: 1 })
    for (let i = 0; i < 3; i++) (await r.acquire('other')).report('greylisted')
    const [h] = r.health()
    expect(h.greylisted).toBe(3)
    expect(h.benchedUntil).toBeNull()
  })

  it('throws when every proxy is benched', async () => {
    const r = new ProxyRouter([proxies[0]], { ...clock(), benchAfter: 1 })
    ;(await r.acquire('other')).report('timeout')
    await expect(r.acquire('other')).rejects.toMatchObject({ code: 'benched' })
  })

  it('counts a lease report only once', async () => {
    const r = new ProxyRouter([proxies[0]], clock())
    const lease = await r.acquire('other')
    lease.report('ok')
    lease.report('ok')
    expect(r.health()[0].ok).toBe(1)
  })
})

describe('ProxyRouter: per-company limits', () => {
  it('lets one person\'s guesses through at once, then paces checks to that company', async () => {
    const c = clock()
    const r = new ProxyRouter(proxies, { ...c, perDomainBurst: 6, domainWindowMs: 180_000, maxWaitMs: 600_000 })
    const start = c.now()
    for (let i = 0; i < 6; i++) await r.acquire('other', 'acme.com')
    expect(c.now()).toBe(start)
    await r.acquire('other', 'acme.com')
    expect(c.now() - start).toBeGreaterThanOrEqual(180_000)
    // Another company isn't held up.
    const before = c.now()
    await r.acquire('other', 'globex.com')
    expect(c.now()).toBe(before)
  })

  it('by default, lets a whole first Reveal at a company through without waiting (catch-all test + 6 guesses)', async () => {
    const c = clock()
    const r = new ProxyRouter(proxies, { ...c })
    const start = c.now()
    for (let i = 0; i < 7; i++) await r.acquire('other', 'irbis-finance.com')
    expect(c.now()).toBe(start)
  })

  it('gives a watching user a clear message instead of waiting minutes', async () => {
    const r = new ProxyRouter(proxies, { ...clock(), perDomainBurst: 1, maxWaitMs: 5_000 })
    await r.acquire('other', 'acme.com')
    await expect(r.acquire('other', 'acme.com')).rejects.toThrow(/acme\.com has been checked a lot/)
  })

  it('stops checking a company for the day after too many rejected guesses', async () => {
    const c = clock()
    const r = new ProxyRouter(proxies, { ...c, rejectionsPerDomainPerDay: 3, perDomainBurst: 100 })
    for (let i = 0; i < 3; i++) (await r.acquire('other', 'acme.com')).report('ok', true)
    await expect(r.acquire('other', 'acme.com')).rejects.toMatchObject({ code: 'domain_rejections' })
    await expect(r.acquire('other', 'globex.com')).resolves.toBeTruthy()
    c.advance(24 * 60 * 60_000 + 1)
    await expect(r.acquire('other', 'acme.com')).resolves.toBeTruthy()
  })

  it('does not count checks that hit real mailboxes toward that cap', async () => {
    const r = new ProxyRouter([proxies[0]], { ...clock(), rejectionsPerDomainPerDay: 2, perDomainBurst: 100, perProxyPerMinute: 100, perProviderPerMinute: { other: 100 } as any })
    for (let i = 0; i < 10; i++) (await r.acquire('other', 'acme.com')).report('ok', false)
    await expect(r.acquire('other', 'acme.com')).resolves.toBeTruthy()
  })
})

describe('ProxyRouter: daily cap and pausing', () => {
  it('stops using an IP for the day at its cap, and says so when all are used up', async () => {
    const r = new ProxyRouter(proxies, { ...clock(), dailyCapPerIp: () => 2 })
    const labels = []
    for (let i = 0; i < 4; i++) labels.push((await r.acquire('other')).proxy?.label)
    expect(labels.sort()).toEqual(['a', 'a', 'b', 'b'])
    await expect(r.acquire('other')).rejects.toMatchObject({ code: 'daily_cap', message: expect.stringMatching(/2 checks per IP/) })
    expect(r.health().map((h) => [h.checksToday, h.dailyCap])).toEqual([[2, 2], [2, 2]])
  })

  it('skips a paused (blocklisted) IP, and pauses verification when every IP is', async () => {
    let pausedHosts = new Set(['a.example'])
    const r = new ProxyRouter(proxies, { ...clock(), pausedReason: (p) => (p && pausedHosts.has(p.host) ? `${p.label} is on Spamhaus` : null) })
    const labels = new Set<string | undefined>()
    for (let i = 0; i < 4; i++) labels.add((await r.acquire('other')).proxy?.label)
    expect(labels).toEqual(new Set(['b']))
    expect(r.health().find((h) => h.label === 'a')?.paused).toMatch(/Spamhaus/)

    pausedHosts = new Set(['a.example', 'b.example'])
    await expect(r.acquire('other')).rejects.toMatchObject({ code: 'paused', message: expect.stringMatching(/Verification is paused: a is on Spamhaus/) })
    // Cleared by the next health check: back in use.
    pausedHosts = new Set()
    await expect(r.acquire('other')).resolves.toBeTruthy()
  })

  it('pauses direct checks too when this server\'s own IP is listed', async () => {
    const r = new ProxyRouter([], { ...clock(), pausedReason: (p) => (p === null ? 'this server is listed' : null) })
    await expect(r.acquire('other')).rejects.toMatchObject({ code: 'paused' })
  })

  it('rests an IP whose recent checks are mostly blocked, even if not in a row, and says so', async () => {
    const c = clock()
    const onPause = vi.fn()
    const r = new ProxyRouter([proxies[0]], {
      ...c,
      benchAfter: 99,
      blockRateWindow: 10,
      blockRateMinChecks: 10,
      blockRatePause: 0.3,
      blockRatePauseMs: 60 * 60_000,
      onPause,
      perProxyPerMinute: 100,
    })
    // blocked, ok, ok, blocked, ok, ok, blocked … : never 2 in a row, but 40% blocked.
    for (let i = 0; i < 10; i++) (await r.acquire('other')).report(i % 3 === 0 ? 'blocked' : 'ok')
    expect(onPause).toHaveBeenCalledWith('a', expect.stringMatching(/40% of its last checks were blocked/))
    expect(r.health()[0].benchedUntil).not.toBeNull()
    c.advance(60 * 60_000 + 1)
    expect(r.health()[0].benchedUntil).toBeNull()
  })
})

describe('parseProxyConfig', () => {
  it('parses valid entries and drops invalid ones', () => {
    expect(
      parseProxyConfig(JSON.stringify([
        { host: 'p1', port: 1080, username: 'u', password: 'p', label: 'one' },
        { host: 'p2' },
        { port: 1080 },
      ])),
    ).toEqual([{ host: 'p1', port: 1080, username: 'u', password: 'p', label: 'one' }])
  })

  it('treats missing or malformed config as no proxies', () => {
    expect(parseProxyConfig(undefined)).toEqual([])
    expect(parseProxyConfig('not json')).toEqual([])
    expect(parseProxyConfig('{"host":"x"}')).toEqual([])
  })
})

describe('providerFromMx', () => {
  it('recognises Google and Microsoft MX hosts', () => {
    expect(providerFromMx(['aspmx.l.google.com'])).toBe('google')
    expect(providerFromMx(['acme-com.mail.protection.outlook.com'])).toBe('microsoft')
    expect(providerFromMx(['mx1.mailgun.org'])).toBe('other')
  })
})

describe('sender domain rejections', () => {
  const ionos =
    'permanent: Requested action not taken: mailbox unavailable; Reject due to policy restrictions.; For explanation visit https://postmaster.1und1.de/en/case?c=r1102&i=ip&v=203.0.113.10&r=1M1bgp-1xBnFH2oHr-00B01v'
  const outcome = (message: string) => classifySmtpOutcome({ is_reachable: 'unknown', smtp: { error: { type: 'SmtpError', message } } })

  it('recognises a refusal of the verification domain, not the IP', () => {
    expect(outcome(ionos)).toBe('sender_rejected')
    expect(outcome('554 5.7.1 <check@listed-sender.example>: Sender address rejected: domain listed at dbl.spamhaus.org')).toBe('sender_rejected')
    expect(outcome('550 5.7.1 Service unavailable; Sender domain blacklisted')).toBe('sender_rejected')
    expect(outcome('504 5.5.2 <verify1>: Helo command rejected: need fully-qualified hostname')).toBe('sender_rejected')
  })

  it('still treats a refusal of the connecting IP as an IP block', () => {
    expect(outcome('554 5.7.1 Service unavailable; Client host [203.0.113.10] blocked using zen.spamhaus.org')).toBe('blocked')
    // IONOS's other policy codes are about the IP.
    expect(outcome('Reject due to policy restrictions.; For explanation visit https://postmaster.1und1.de/en/case?c=r0102&i=ip&v=1.2.3.4')).toBe('blocked')
  })

  it('never rests or pauses an IP for sender-domain refusals', async () => {
    const r = new ProxyRouter([proxies[0]], { ...clock(), benchAfter: 1, blockRateMinChecks: 1, perProxyPerMinute: 100 })
    for (let i = 0; i < 10; i++) (await r.acquire('other')).report('sender_rejected')
    expect(r.health()[0]).toMatchObject({ senderRejected: 10, blocked: 0, benchedUntil: null })
  })
})

describe('unreachable mail servers', () => {
  it("counts a company refusing connections separately, without benching after one company's two tries", async () => {
    const r = new ProxyRouter([proxies[0]], { ...clock() })
    for (let i = 0; i < 2; i++) (await r.acquire('other')).report('unreachable')
    expect(r.health()[0]).toMatchObject({ unreachable: 2, blocked: 0, timeouts: 0, benchedUntil: null })
    // A normal answer in between resets the run.
    ;(await r.acquire('other')).report('ok')
    for (let i = 0; i < 5; i++) (await r.acquire('other')).report('unreachable')
    expect(r.health()[0].benchedUntil).toBeNull()
  })

  it('benches a proxy that can reach nobody (e.g. its host blocked port 25)', async () => {
    const r = new ProxyRouter([proxies[0]], { ...clock(), benchAfterUnreachable: 6 })
    for (let i = 0; i < 6; i++) (await r.acquire('other')).report('unreachable')
    expect(r.health()[0].benchedUntil).not.toBeNull()
  })
})

describe('companies that refuse an IP', () => {
  it('sends that company to the other IPs for a while, without affecting other companies', async () => {
    const c = clock()
    const r = new ProxyRouter(proxies, { ...c, refusalMemoryMs: 60 * 60_000 })
    const first = await r.acquire('other', 'profine-group.com')
    expect(first.proxy?.label).toBe('a')
    first.report('unreachable')
    for (let i = 0; i < 3; i++) expect((await r.acquire('other', 'profine-group.com')).proxy?.label).toBe('b')
    const elsewhere = new Set<string | undefined>()
    for (let i = 0; i < 2; i++) elsewhere.add((await r.acquire('other', 'acme.com')).proxy?.label)
    expect(elsewhere).toEqual(new Set(['a', 'b']))

    c.advance(61 * 60_000)
    const labels = new Set<string | undefined>()
    for (let i = 0; i < 2; i++) labels.add((await r.acquire('other', 'profine-group.com')).proxy?.label)
    expect(labels).toEqual(new Set(['a', 'b']))
  })

  it('says so, without waiting, once every IP has been refused', async () => {
    const r = new ProxyRouter([proxies[0]], { ...clock() })
    ;(await r.acquire('other', 'profine-group.com')).report('blocked')
    await expect(r.acquire('other', 'profine-group.com')).rejects.toMatchObject({ code: 'refused' })
    await expect(r.acquire('other', 'acme.com')).resolves.toBeTruthy()
  })

  it('treats a flat refusal in place of the greeting as unreachable', () => {
    const outcome = (message: string) => classifySmtpOutcome({ is_reachable: 'unknown', smtp: { error: { type: 'SmtpError', message } } })
    expect(outcome('permanent: 5.5.0 Not allowed.')).toBe('unreachable')
    expect(outcome('permanent: 554 5.7.1 Client host rejected: cannot find your hostname')).toBe('unreachable')
    // Refusals about the address are not the IP's problem.
    expect(outcome('permanent: 550 5.7.1 Recipient address not allowed')).toBe('ok')
  })
})

describe('classifySmtpOutcome', () => {
  it('separates greylisting, blocks and timeouts', () => {
    expect(classifySmtpOutcome({ is_reachable: 'safe', smtp: { is_deliverable: true } })).toBe('ok')
    expect(classifySmtpOutcome({ is_reachable: 'unknown', smtp: { type: 'SmtpError', message: '451 4.7.1 Greylisted, try again later' } })).toBe('greylisted')
    expect(classifySmtpOutcome({ is_reachable: 'unknown', smtp: { type: 'SmtpError', message: '554 5.7.1 Service unavailable; client host blocked using Spamhaus' } })).toBe('blocked')
    expect(classifySmtpOutcome({ is_reachable: 'unknown', smtp: { type: 'SmtpError', message: 'Connection timed out' } })).toBe('timeout')
    expect(classifySmtpOutcome({ is_reachable: 'unknown', smtp: { type: 'SmtpError', message: 'something odd' } })).toBe('ok')
    // The proxy's own reply: it couldn't connect onward to the company's server.
    expect(classifySmtpOutcome({ is_reachable: 'unknown', smtp: { error: { type: 'Socks5', message: 'Error with reply: TTL expired.' } } })).toBe('unreachable')
    expect(classifySmtpOutcome({ is_reachable: 'unknown', smtp: { error: { type: 'Socks5', message: 'Error with reply: Host unreachable.' } } })).toBe('unreachable')
    // The proxy itself refusing the connection is still the proxy's problem.
    expect(classifySmtpOutcome({ is_reachable: 'unknown', smtp: { error: { type: 'Socks5', message: 'Connection refused (os error 111)' } } })).toBe('blocked')
    // Shape observed from Reacher v0.11.7 when the proxy rejects the login.
    expect(
      classifySmtpOutcome({
        is_reachable: 'unknown',
        smtp: { error: { type: 'Socks5', message: 'Authentication rejected `Authentication with username `reacher`, rejected.`' } },
      }),
    ).toBe('blocked')
  })
})

describe('checkEmail request', () => {
  it('asks Reacher for plain SMTP checks, sends the secret, and routes through the proxy', async () => {
    const { checkEmail } = await import('./reacher')
    let sent: any = null
    let headers: any = null
    const fetchImpl = (async (url: string, init: any) => {
      sent = { url, body: JSON.parse(init.body) }
      headers = init.headers
      return new Response(JSON.stringify({ is_reachable: 'invalid', smtp: { is_catch_all: false } }), { status: 200 })
    }) as unknown as typeof fetch
    const res = await checkEmail(
      'a@b.com',
      { host: 'p.example.com', port: 1080, username: 'u', password: 'pw' },
      { url: 'http://localhost:8080', secret: 's3cret', helloName: 'mail.b.com' },
      fetchImpl,
    )
    expect(sent.url).toBe('http://localhost:8080/v1/check_email')
    expect(sent.body).toMatchObject({
      to_email: 'a@b.com',
      hotmailb2c_verif_method: 'Smtp',
      yahoo_verif_method: 'Smtp',
      hello_name: 'mail.b.com',
      proxy: { host: 'p.example.com', port: 1080, username: 'u', password: 'pw' },
    })
    expect(headers['x-reacher-secret']).toBe('s3cret')
    expect(res).toMatchObject({ reachability: 'invalid', isCatchAll: false, outcome: 'ok' })
  })

  it('explains a refused secret', async () => {
    const { checkEmail } = await import('./reacher')
    const fetchImpl = (async () => new Response('bad', { status: 400 })) as unknown as typeof fetch
    const res = await checkEmail('a@b.com', null, { url: 'http://localhost:8080' }, fetchImpl)
    expect(res.detail).toMatch(/secret/)
  })
})
