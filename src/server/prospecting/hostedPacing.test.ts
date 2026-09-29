import { describe, expect, it } from 'vitest'
import { ProxyRouter } from './proxyRouter'
import { hostedRouterOptions } from './runtime'

// A controllable clock: `sleep` advances time instead of waiting.
function clock() {
  let now = 1_000_000
  return { now: () => now, sleep: async (ms: number) => void (now += ms), advance: (ms: number) => void (now += ms) }
}

describe('checks in a hosted copy', () => {
  it("queue to the host's per-minute share instead of going over it, whatever the mail provider", async () => {
    const c = clock()
    const router = new ProxyRouter([], { ...c, ...hostedRouterOptions({ perMinute: 15, perDay: 600 }), perDomainBurst: 100 })
    const start = c.now()
    // Google checks aren't held to one IP's 10 a minute: the host spreads them.
    for (let i = 0; i < 15; i++) await router.acquire('google', `co${i}.test`)
    expect(c.now()).toBe(start)
    // The 16th waits for the minute to roll over rather than being turned away.
    await router.acquire('google', 'co15.test')
    expect(c.now() - start).toBeGreaterThanOrEqual(60_000)
  })

  it("pace each provider to what the host's IPs can take", async () => {
    const c = clock()
    const router = new ProxyRouter([], { ...c, ...hostedRouterOptions({ perMinute: 15, perDay: 600, perProvider: { google: 10, microsoft: 6, other: 15 } }), perDomainBurst: 100 })
    const start = c.now()
    for (let i = 0; i < 10; i++) await router.acquire('google', `co${i}.test`)
    await router.acquire('other', 'co-other.test')
    expect(c.now()).toBe(start)
    await router.acquire('google', 'co10.test')
    expect(c.now() - start).toBeGreaterThanOrEqual(60_000)
  })

  it('never stop for timeouts: the host watches its own IPs', async () => {
    const router = new ProxyRouter([], { ...clock(), ...hostedRouterOptions({ perMinute: 15, perDay: 600 }) })
    for (let i = 0; i < 10; i++) (await router.acquire('other', `co${i}.test`)).report('timeout')
    await expect(router.acquire('other', 'next.test')).resolves.toBeTruthy()
  })

  it("stop at the day's share with the customer's own message", async () => {
    const router = new ProxyRouter([], { ...clock(), ...hostedRouterOptions({ perMinute: 100, perDay: 3 }), perDomainBurst: 100 })
    for (let i = 0; i < 3; i++) await router.acquire('other', `co${i}.test`)
    await expect(router.acquire('other', 'co4.test')).rejects.toMatchObject({
      code: 'daily_cap',
      message: expect.stringMatching(/Your account's email verification limit for today \(3 checks\)/),
    })
  })
})
