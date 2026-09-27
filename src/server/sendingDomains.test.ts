import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Scratch database, so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'sending-domains-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const {
  addSendingDomain,
  canSendFrom,
  checkSendingDomain,
  getSendingDomains,
  normalizeDomain,
  removeSendingDomain,
  requireSendingDomain,
} = await import('./sendingDomains')
const { db } = await import('./db')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

/** A fake host: the domains it holds for this copy, and whether their DNS records are in place. */
function fakeHost() {
  const domains = new Map<string, { ready: boolean }>()
  const calls: Array<{ method: string; domain: string }> = []
  const host = async (method: 'PUT' | 'DELETE', domain: string) => {
    calls.push({ method, domain })
    if (method === 'DELETE') {
      domains.delete(domain)
      return { status: 200, json: {} }
    }
    if (domain === 'gmail.com') return { status: 400, json: { error: "gmail.com can't be a sending domain." } }
    const d = domains.get(domain) ?? { ready: false }
    domains.set(domain, d)
    return {
      status: 200,
      json: {
        domain,
        ready: d.ready,
        ...(d.ready ? {} : { waitingFor: 'Waiting for the DKIM record.' }),
        records: [
          { type: 'TXT', name: `m1._domainkey.${domain}`, value: 'v=DKIM1; k=rsa; p=MIIB', purpose: 'Signs your email (DKIM)' },
          { type: 'TXT', name: `_dmarc.${domain}`, value: 'v=DMARC1; p=none;', purpose: 'DMARC', optional: true },
          { type: 'SRV', name: 'junk', value: 'dropped', purpose: 'not a record type we show' },
        ],
      },
    }
  }
  return { domains, calls, host }
}

const originalManaged = process.env.SENDING_MANAGED

beforeEach(() => {
  db.saveSendingDomains([])
})
afterEach(() => {
  if (originalManaged === undefined) delete process.env.SENDING_MANAGED
  else process.env.SENDING_MANAGED = originalManaged
})

describe('sending domains', () => {
  it('reads a domain however it is typed', () => {
    expect(normalizeDomain(' Acme.COM ')).toBe('acme.com')
    expect(normalizeDomain('https://acme.co.uk/contact')).toBe('acme.co.uk')
    expect(normalizeDomain('jo@news.acme.com')).toBe('news.acme.com')
    for (const bad of ['', 'acme', 'acme..com', '-acme.com', 'acme.com; rm -rf /', 'a'.repeat(300) + '.com']) expect(normalizeDomain(bad)).toBeNull()
  })

  it("adds the domain on the host and keeps the records it asks for", async () => {
    const { host, calls } = fakeHost()
    const d = await addSendingDomain('Acme.com', { host })
    expect(calls).toEqual([{ method: 'PUT', domain: 'acme.com' }])
    expect(d.records.map((r) => [r.type, r.name])).toEqual([
      ['TXT', 'm1._domainkey.acme.com'],
      ['TXT', '_dmarc.acme.com'],
    ])
    expect(d.records[1].optional).toBe(true)
    expect(d).toMatchObject({ ready: false, waitingFor: 'Waiting for the DKIM record.' })
    expect(getSendingDomains().map((x) => x.domain)).toEqual(['acme.com'])
    await addSendingDomain('acme.com', { host })
    expect(calls).toHaveLength(1) // already added
  })

  it("shows the host's refusal and saves nothing", async () => {
    const { host } = fakeHost()
    await expect(addSendingDomain('gmail.com', { host })).rejects.toThrow("gmail.com can't be a sending domain.")
    expect(getSendingDomains()).toEqual([])
  })

  it('is ready once the host has found its records, subdomains included', async () => {
    const { host, domains } = fakeHost()
    await addSendingDomain('acme.com', { host })
    expect(canSendFrom('hello@acme.com')).toBe(false)

    domains.get('acme.com')!.ready = true
    const d = await checkSendingDomain('acme.com', { host })
    expect(d.waitingFor).toBeUndefined()
    expect(canSendFrom('"Jo" <Hello@Acme.com>')).toBe(true)
    expect(canSendFrom('news@mail.acme.com')).toBe(true)
    expect(canSendFrom('hello@acme.co')).toBe(false)
    expect(canSendFrom('hello@notacme.com')).toBe(false)
  })

  it('adds a domain saved before the host ran its own mail server when it is next checked', async () => {
    db.saveSendingDomains([
      { domain: 'old.com', ownershipToken: 'x', dkimTokens: ['a'], sesVerified: true, dkimStatus: 'SUCCESS', ownershipVerified: true, addedAt: '2026-01-01T00:00:00.000Z', checkedAt: '2026-09-01T00:00:00.000Z' } as any,
    ])
    expect(getSendingDomains()).toEqual([{ domain: 'old.com', records: [], ready: false, addedAt: '2026-01-01T00:00:00.000Z', checkedAt: null }])
    expect(canSendFrom('hi@old.com')).toBe(false)
    const { host, calls } = fakeHost()
    const d = await checkSendingDomain('old.com', { host })
    expect(calls).toEqual([{ method: 'PUT', domain: 'old.com' }])
    expect(d.records[0].name).toBe('m1._domainkey.old.com')
    expect(d.addedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('stops sending from a removed domain, here and on the host', async () => {
    const { host, domains, calls } = fakeHost()
    await addSendingDomain('acme.com', { host })
    domains.get('acme.com')!.ready = true
    await checkSendingDomain('acme.com', { host })
    await removeSendingDomain('acme.com', { host })
    expect(canSendFrom('hello@acme.com')).toBe(false)
    expect(calls.at(-1)).toEqual({ method: 'DELETE', domain: 'acme.com' })
  })

  it('refuses unverified senders only when the host runs sending', () => {
    delete process.env.SENDING_MANAGED
    expect(() => requireSendingDomain('me@anything.test')).not.toThrow()
    process.env.SENDING_MANAGED = 'on'
    expect(() => requireSendingDomain('me@anything.test')).toThrow("anything.test isn't a verified sending domain yet")
  })
})
