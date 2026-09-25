import { describe, expect, it } from 'vitest'
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

  it('applies stricter per-provider limits across all proxies', async () => {
    const c = clock()
    const r = new ProxyRouter(proxies, { ...c, perProviderPerMinute: { microsoft: 1, google: 10, other: 60 }, maxWaitMs: 5_000 })
    await r.acquire('microsoft')
    await expect(r.acquire('microsoft')).rejects.toThrow(/rate limit/)
    // Other providers are unaffected.
    await expect(r.acquire('other')).resolves.toBeTruthy()
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
    await expect(r.acquire('other')).rejects.toThrow(/benched/)
  })

  it('counts a lease report only once', async () => {
    const r = new ProxyRouter([proxies[0]], clock())
    const lease = await r.acquire('other')
    lease.report('ok')
    lease.report('ok')
    expect(r.health()[0].ok).toBe(1)
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

describe('classifySmtpOutcome', () => {
  it('separates greylisting, blocks and timeouts', () => {
    expect(classifySmtpOutcome({ is_reachable: 'safe', smtp: { is_deliverable: true } })).toBe('ok')
    expect(classifySmtpOutcome({ is_reachable: 'unknown', smtp: { type: 'SmtpError', message: '451 4.7.1 Greylisted, try again later' } })).toBe('greylisted')
    expect(classifySmtpOutcome({ is_reachable: 'unknown', smtp: { type: 'SmtpError', message: '554 5.7.1 Service unavailable; client host blocked using Spamhaus' } })).toBe('blocked')
    expect(classifySmtpOutcome({ is_reachable: 'unknown', smtp: { type: 'SmtpError', message: 'Connection timed out' } })).toBe('timeout')
    expect(classifySmtpOutcome({ is_reachable: 'unknown', smtp: { type: 'SmtpError', message: 'something odd' } })).toBe('ok')
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
