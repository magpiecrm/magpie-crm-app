import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkEmailNeverBounce, getNeverBounceCredits } from './neverbounce'

// NeverBounce via a fake fetch; no network, no credits.

const KEY = 'secret_0123456789abcdef'

function respond(body: unknown, status = 200) {
  const calls: URL[] = []
  const impl = vi.fn(async (url: URL | string) => {
    calls.push(new URL(String(url)))
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { impl, calls }
}

afterEach(() => vi.restoreAllMocks())

describe('checkEmailNeverBounce', () => {
  it('calls single/check with the key, address and a timeout', async () => {
    const f = respond({ status: 'success', result: 'valid' })
    await checkEmailNeverBounce('jane@acme.com', KEY, f.impl)
    expect(f.calls[0].origin + f.calls[0].pathname).toBe('https://api.neverbounce.com/v4.2/single/check')
    expect(f.calls[0].searchParams.get('key')).toBe(KEY)
    expect(f.calls[0].searchParams.get('email')).toBe('jane@acme.com')
    expect(f.calls[0].searchParams.get('timeout')).toBe('30')
  })

  it.each([
    ['valid', { reachability: 'safe', isCatchAll: false }],
    ['invalid', { reachability: 'invalid', isCatchAll: false }],
    ['disposable', { reachability: 'invalid', isCatchAll: false }],
    ['catchall', { reachability: 'unknown', isCatchAll: true }],
    ['unknown', { reachability: 'unknown', isCatchAll: null }],
  ])('maps %s', async (result, expected) => {
    const f = respond({ status: 'success', result })
    expect(await checkEmailNeverBounce('a@b.com', KEY, f.impl)).toMatchObject({ ...expected, outcome: 'ok' })
  })

  it('explains a rejected key and rate limiting', async () => {
    const auth = await checkEmailNeverBounce('a@b.com', KEY, respond({ status: 'auth_failure', message: 'Invalid API key' }).impl)
    expect(auth).toMatchObject({ reachability: 'unknown', detail: expect.stringMatching(/rejected the API key/) })
    const throttled = await checkEmailNeverBounce('a@b.com', KEY, respond({ status: 'throttle_triggered', message: 'slow down' }).impl)
    expect(throttled.detail).toMatch(/rate limiting/)
    const other = await checkEmailNeverBounce('a@b.com', KEY, respond({ status: 'general_failure', message: 'Insufficient credits' }).impl)
    expect(other.detail).toBe('NeverBounce: Insufficient credits')
  })

  it('treats HTTP and network failures as unknown, not invalid', async () => {
    expect(await checkEmailNeverBounce('a@b.com', KEY, respond({}, 503).impl)).toMatchObject({ reachability: 'unknown', isCatchAll: null })
    const broken = (async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    expect(await checkEmailNeverBounce('a@b.com', KEY, broken)).toMatchObject({ reachability: 'unknown', detail: 'Could not reach NeverBounce.' })
  })

  it('never logs the key or the address', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await checkEmailNeverBounce('jane@acme.com', KEY, respond({ status: 'auth_failure', message: 'bad' }).impl)
    await checkEmailNeverBounce('jane@acme.com', KEY, respond({}, 500).impl)
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).not.toContain(KEY)
    expect(logged).not.toContain('jane@acme.com')
  })
})

describe('getNeverBounceCredits', () => {
  it('adds paid and free credits', async () => {
    const f = respond({ status: 'success', credits_info: { paid_credits_remaining: 900, free_credits_remaining: 100 } })
    expect(await getNeverBounceCredits(KEY, f.impl)).toBe(1000)
    expect(f.calls[0].pathname).toBe('/v4.2/account/info')
  })

  it('throws NeverBounce’s own error', async () => {
    await expect(getNeverBounceCredits(KEY, respond({ status: 'auth_failure', message: 'x' }).impl)).rejects.toThrow(/API key/)
  })
})
