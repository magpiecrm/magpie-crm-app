import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshHostRules } from './hostRules'
import { contribute, knownPeople, setContributing, sharedEmail } from './sharedPeople'
import { profileHash } from './suppressionHash'
import type { PersonResult } from './types'

const saved = { ...process.env }
beforeEach(() => {
  delete (globalThis as any).__hostRules
  Object.assign(process.env, { PROSPECTING_MANAGED: 'on', REACHER_URL: 'https://services.magpie.test', REACHER_SECRET: 'vt_mc_acme' })
})
afterEach(() => {
  process.env = { ...saved }
  delete (globalThis as any).__hostRules
})

/** A host with a shared database, answering as magpie-cloud does. */
function host(start: { contributing: boolean; search?: boolean }) {
  const state = { ...start }
  const sent: Array<{ path: string; secret: string | null; body: any }> = []
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname
    const body = init.body ? JSON.parse(String(init.body)) : null
    if (init.method === 'POST') sent.push({ path, secret: new Headers(init.headers).get('x-reacher-secret'), body })
    if (path === '/v1/prospecting') return Response.json({ rules: {}, pool: { available: true, search: state.search ?? true, contributing: state.contributing, termsVersion: '2026-10' } })
    if (path === '/v1/pool/known') {
      const held = body.profiles.includes(profileHash(jane.profileUrl))
      return Response.json({
        people: held
          ? [{ profile: profileHash(jane.profileUrl), handle: '7.2026-10-11.sig', title: 'Sales Director', seniority: 'director', company: 'Acme', companyRef: '1', companyDomain: 'acme.com', country: 'United Kingdom', verifiedAt: '2026-10-01T00:00:00.000Z' }]
          : [],
      })
    }
    if (path === '/v1/pool/reveal') return body.handle === '7.2026-10-11.sig' ? Response.json({ email: 'Jane.Smith@acme.com', free: state.contributing }) : Response.json({ error: 'Not available.' }, { status: 404 })
    if (path === '/v1/pool/membership') {
      if (body.termsVersion !== '2026-10') return Response.json({ error: 'The terms have changed. Reload the page and read them again.' }, { status: 409 })
      state.contributing = body.contribute
      return Response.json({ contributing: state.contributing })
    }
    return Response.json({ accepted: 1, rejected: 0 })
  }) as unknown as typeof fetch
  return { fetchImpl, sent }
}

const jane: PersonResult = {
  profileUrl: 'https://www.linkedin.com/in/jane-smith',
  firstName: 'Jane',
  lastName: 'Smith',
  title: 'Head of Sales',
  seniority: 'head',
  company: 'Acme',
  companyRef: '1',
  companyDomain: 'acme.com',
  country: 'United Kingdom',
  source: 'socialfetch',
  catchAll: false,
  previously: 'revealed',
}
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('the shared database', () => {
  it('is joined by name, with the terms the host showed, and left the same way', async () => {
    const { fetchImpl, sent } = host({ contributing: false })
    await refreshHostRules(fetchImpl)
    expect(await setContributing(true, 'owner@acme.test', fetchImpl)).toBe(true)
    expect(sent[0]).toEqual({ path: '/v1/pool/membership', secret: 'vt_mc_acme', body: { contribute: true, actor: 'owner@acme.test', termsVersion: '2026-10' } })
    const { sharedDatabase } = await import('./hostRules')
    expect(sharedDatabase()?.contributing).toBe(true)
    expect(await setContributing(false, 'owner@acme.test', fetchImpl)).toBe(false)
    expect(sharedDatabase()?.contributing).toBe(false)
  })

  it("gives the host's reason when it refuses, and can't be joined from a copy that isn't hosted", async () => {
    const { fetchImpl } = host({ contributing: false })
    await expect(setContributing(true, 'owner@acme.test', fetchImpl)).rejects.toThrow('The terms have changed')
    delete process.env.PROSPECTING_MANAGED
    await expect(setContributing(true, 'owner@acme.test', fetchImpl)).rejects.toThrow("isn't hosted")
  })

  it('is sent a saved contact with a verified email: what search held and the address, nothing more', async () => {
    const { fetchImpl, sent } = host({ contributing: true })
    await refreshHostRules(fetchImpl)
    contribute(jane, 'jane.smith@acme.com', 'verified', fetchImpl)
    await settle()
    expect(sent).toEqual([
      {
        path: '/v1/pool/contribute',
        secret: 'vt_mc_acme',
        body: {
          people: [
            {
              profileUrl: 'https://www.linkedin.com/in/jane-smith', firstName: 'Jane', lastName: 'Smith', title: 'Head of Sales', company: 'Acme', companyRef: '1',
              country: 'United Kingdom', email: 'jane.smith@acme.com', emailStatus: 'verified', source: 'socialfetch',
            },
          ],
        },
      },
    ])
  })

  it("isn't sent someone back whose email it gave", async () => {
    const { fetchImpl, sent } = host({ contributing: true })
    await refreshHostRules(fetchImpl)
    contribute({ ...jane, shared: '7.2026-10-11.sig' }, 'jane.smith@acme.com', 'verified', fetchImpl)
    await settle()
    expect(sent).toEqual([])
  })

  it('says which of the people a search found it holds, asked by the hash of their profile address only', async () => {
    const { fetchImpl, sent } = host({ contributing: false })
    await refreshHostRules(fetchImpl)
    const other = { ...jane, profileUrl: 'https://www.linkedin.com/in/someone-else', firstName: 'Sam' }
    const held = await knownPeople([jane, other], fetchImpl)
    expect([...held]).toEqual([
      [jane.profileUrl, { handle: '7.2026-10-11.sig', title: 'Sales Director', seniority: 'director', company: 'Acme', companyRef: '1', companyDomain: 'acme.com', country: 'United Kingdom', verifiedAt: '2026-10-01T00:00:00.000Z' }],
    ])
    expect(sent).toEqual([{ path: '/v1/pool/known', secret: 'vt_mc_acme', body: { profiles: [profileHash(jane.profileUrl), profileHash(other.profileUrl)] } }])
    expect(JSON.stringify(sent)).not.toMatch(/jane|smith|linkedin/i)
  })

  it("is asked nothing where searching isn't switched on, and a search carries on when it doesn't answer", async () => {
    const off = host({ contributing: true, search: false })
    await refreshHostRules(off.fetchImpl)
    expect((await knownPeople([jane], off.fetchImpl)).size).toBe(0)
    expect(off.sent).toEqual([])

    const on = host({ contributing: true })
    await refreshHostRules(on.fetchImpl)
    expect((await knownPeople([jane], (async () => Promise.reject(new Error('down'))) as unknown as typeof fetch)).size).toBe(0)
    expect((await knownPeople([jane], (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch)).size).toBe(0)
  })

  it('gives the email for a handle, says whether it was free, and nothing for a handle it no longer honours', async () => {
    const { fetchImpl } = host({ contributing: true })
    expect(await sharedEmail('7.2026-10-11.sig', fetchImpl)).toEqual({ email: 'jane.smith@acme.com', free: true })
    expect(await sharedEmail('old', fetchImpl)).toBeNull()
    expect(await sharedEmail('7.2026-10-11.sig', host({ contributing: false }).fetchImpl)).toEqual({ email: 'jane.smith@acme.com', free: false })
  })

  it('is sent nothing by a copy that has not joined, for a guessed address, or when the host is down', async () => {
    const out = host({ contributing: false })
    await refreshHostRules(out.fetchImpl)
    contribute(jane, 'jane.smith@acme.com', 'verified', out.fetchImpl)

    const joined = host({ contributing: true })
    await refreshHostRules(joined.fetchImpl)
    contribute(jane, 'jane.smith@acme.com', 'catch_all_likely', joined.fetchImpl)
    contribute(jane, 'jane.smith@acme.com', 'format_confirmed', joined.fetchImpl)
    // A host that doesn't answer never fails the save.
    contribute(jane, 'jane.smith@acme.com', 'verified', (async () => Promise.reject(new Error('down'))) as unknown as typeof fetch)
    await settle()
    expect([...out.sent, ...joined.sent]).toEqual([])
  })
})
