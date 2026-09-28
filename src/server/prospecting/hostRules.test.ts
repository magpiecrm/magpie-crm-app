import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_RULES, formatSharingOn, prospectingRules, refreshHostRules } from './hostRules'

const KEYS = ['PROSPECTING_MANAGED', 'REACHER_URL', 'REACHER_SECRET'] as const
const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

beforeEach(() => {
  delete (globalThis as any).__hostRules
  Object.assign(process.env, { PROSPECTING_MANAGED: 'on', REACHER_URL: 'https://services.magpie.test', REACHER_SECRET: 'vt_mc_acme' })
})
afterEach(() => {
  for (const k of KEYS) (original[k] === undefined ? delete process.env[k] : (process.env[k] = original[k]))
  delete (globalThis as any).__hostRules
})

describe('host rules', () => {
  it('use the defaults until the host answers, then its rules, kept in range', async () => {
    expect(prospectingRules()).toEqual(DEFAULT_RULES)
    expect(formatSharingOn()).toBe(false)
    const answer = await refreshHostRules(reply({ rules: { formatConfirmed: 0.9, firstBatch: 24.6, holdHours: 500, maxBounceRate: 0.01 }, formatSharing: true, eventsPending: true }))
    expect(answer).toMatchObject({ formatSharing: true, eventsPending: true })
    expect(prospectingRules()).toEqual({ formatConfirmed: 0.9, firstBatch: 25, holdHours: DEFAULT_RULES.holdHours, maxBounceRate: 0.01 })
    expect(formatSharingOn()).toBe(true)
  })

  it('keep the last answer when the host fails, and are never asked outside a hosted copy', async () => {
    await refreshHostRules(reply({ rules: { firstBatch: 30 }, formatSharing: true }))
    expect(await refreshHostRules(reply({}, 500))).toBeNull()
    expect(prospectingRules().firstBatch).toBe(30)
    delete process.env.PROSPECTING_MANAGED
    let asked = false
    expect(await refreshHostRules((async () => ((asked = true), new Response('{}'))) as unknown as typeof fetch)).toBeNull()
    expect(asked).toBe(false)
    expect(formatSharingOn()).toBe(false)
  })
})
