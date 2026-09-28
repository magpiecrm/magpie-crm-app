import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshHostRules } from './hostRules'
import { cachedSharedFormat, formatCounts, reportFormats, sharedFormat } from './sharedFormats'
import type { KnownAddress } from './patternEvidence'

const KEYS = ['PROSPECTING_MANAGED', 'REACHER_URL', 'REACHER_SECRET'] as const
const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

const at = (email: string, name: string, kind: KnownAddress['kind'] = 'known'): KnownAddress => {
  const [firstName, lastName] = name.split(' ')
  return { email, firstName, lastName, kind }
}

async function hosted(formatSharing: boolean) {
  Object.assign(process.env, { PROSPECTING_MANAGED: 'on', REACHER_URL: 'https://services.magpie.test', REACHER_SECRET: 'vt_mc_acme' })
  await refreshHostRules((async () => new Response(JSON.stringify({ rules: {}, formatSharing, eventsPending: false }))) as unknown as typeof fetch)
}

function recorder(answer: unknown = { answers: [] }) {
  const bodies: any[] = []
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify(answer))
  }) as unknown as typeof fetch
  return { bodies, fetchImpl }
}

beforeEach(() => {
  delete (globalThis as any).__hostRules
  ;(globalThis as any).__sharedFormats?.clear()
})
afterEach(() => {
  for (const k of KEYS) (original[k] === undefined ? delete process.env[k] : (process.env[k] = original[k]))
  delete (globalThis as any).__hostRules
})

describe('formatCounts', () => {
  it('counts real addresses per company format, never bounced ones, personal mailboxes or names', () => {
    const counts = formatCounts([
      at('bob.jones@acme.test', 'Bob Jones'),
      at('ann.lee@acme.test', 'Ann Lee', 'engaged'),
      at('tom.hart@acme.test', 'Tom Hart', 'bounced'),
      at('jsmith@acme.test', 'Jane Smith'),
      at('sales@acme.test', 'Bob Jones'),
      at('bob.jones@gmail.com', 'Bob Jones'),
    ])
    expect(Object.fromEntries(counts)).toEqual({ 'acme.test': { '{first}.{last}': 2, '{f}{last}': 1 } })
    expect(JSON.stringify(Object.fromEntries(counts))).not.toMatch(/bob|jones|ann|jane/)
  })
})

describe('sharing formats with the host', () => {
  it('reports formats and counts only, in a hosted copy taking part', async () => {
    await hosted(true)
    const { bodies, fetchImpl } = recorder({})
    expect(await reportFormats([at('bob.jones@acme.test', 'Bob Jones')], fetchImpl)).toBe(1)
    expect(bodies).toEqual([{ report: [{ domain: 'acme.test', counts: { '{first}.{last}': 1 } }] }])
  })

  it('neither reports nor asks when left out', async () => {
    await hosted(false)
    const { bodies, fetchImpl } = recorder()
    expect(await reportFormats([at('bob.jones@acme.test', 'Bob Jones')], fetchImpl)).toBe(0)
    expect(await sharedFormat('acme.test', 500, fetchImpl)).toBeNull()
    expect(bodies).toEqual([])
  })

  it('asks only about companies of 10 or more, and keeps the answer for a day', async () => {
    await hosted(true)
    const { bodies, fetchImpl } = recorder({ answers: [{ domain: 'acme.test', counts: { '{f}{last}': 4 } }] })
    expect(await sharedFormat('acme.test', 9, fetchImpl)).toBeNull()
    expect(await sharedFormat('acme.test', null, fetchImpl)).toBeNull()
    expect(bodies).toEqual([])
    const now = Date.now()
    expect(await sharedFormat('ACME.test', 500, fetchImpl, now)).toEqual({ '{f}{last}': 4 })
    expect(await sharedFormat('acme.test', 500, fetchImpl, now + 60_000)).toEqual({ '{f}{last}': 4 })
    expect(bodies).toEqual([{ ask: [{ domain: 'acme.test', headcount: 500 }] }])
    expect(cachedSharedFormat('acme.test', now + 60_000)).toEqual({ '{f}{last}': 4 })
    expect(cachedSharedFormat('acme.test', now + 25 * 60 * 60_000)).toBeNull()
  })
})
