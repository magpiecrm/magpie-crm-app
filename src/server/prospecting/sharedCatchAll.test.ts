import { afterEach, describe, expect, it } from 'vitest'
import { sharedCatchAll } from './sharedCatchAll'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
})

function hosted() {
  process.env.PROSPECTING_MANAGED = 'on'
  process.env.REACHER_URL = 'https://services.magpie.test/'
  process.env.REACHER_SECRET = 'vt_mc_acme'
}

function host(answer: (body: any) => Response | Promise<Response>) {
  const sent: Array<{ url: string; headers: any; body: any }> = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    sent.push({ url, headers: init.headers, body })
    return answer(body)
  }) as unknown as typeof fetch
  return { fetchImpl, sent }
}

describe('sharedCatchAll', () => {
  it('asks nothing outside a hosted copy', async () => {
    delete process.env.PROSPECTING_MANAGED
    const { fetchImpl, sent } = host(() => Response.json({}))
    expect(await sharedCatchAll([{ ref: '1', domain: 'ocado.test' }], fetchImpl)).toEqual([false])
    expect(sent).toEqual([])
  })

  it("sends only company refs and domains, and marks the companies the host says accept every address", async () => {
    hosted()
    const { fetchImpl, sent } = host((body) => Response.json({ companies: body.companies.map((c: any) => ({ ...c, catchAll: c.ref === '1' ? true : c.domain === 'acme.test' ? false : null })) }))
    const res = await sharedCatchAll([{ ref: '1', domain: null }, { ref: null, domain: null }, { ref: '2', domain: 'acme.test' }, { ref: '3', domain: 'new.test' }], fetchImpl)
    expect(res).toEqual([true, false, false, false])
    expect(sent[0].url).toBe('https://services.magpie.test/v1/catch-all')
    expect(sent[0].headers).toMatchObject({ 'x-reacher-secret': 'vt_mc_acme' })
    // The company with neither isn't sent.
    expect(sent[0].body).toEqual({ companies: [{ ref: '1' }, { ref: '2', domain: 'acme.test' }, { ref: '3', domain: 'new.test' }] })
  })

  it("carries on unmarked when the host doesn't answer", async () => {
    hosted()
    const failing = host(() => new Response('nope', { status: 502 }))
    expect(await sharedCatchAll([{ ref: '1', domain: null }], failing.fetchImpl)).toEqual([false])
    const throwing = (async () => {
      throw new Error('timeout')
    }) as unknown as typeof fetch
    expect(await sharedCatchAll([{ ref: '1', domain: null }], throwing)).toEqual([false])
  })
})
