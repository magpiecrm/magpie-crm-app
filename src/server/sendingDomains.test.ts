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
  dnsRecords,
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

/** A fake SES account: identities and whether each is verified. */
function fakeSes() {
  const identities = new Map<string, { verified: boolean; tokens: string[] }>()
  const calls: Array<{ method: string; path: string; body?: any }> = []
  const ses = async (method: 'GET' | 'POST', path: string, body?: any) => {
    calls.push({ method, path, body })
    if (method === 'POST' && path === '/v2/email/identities') {
      if (identities.has(body.EmailIdentity)) return { status: 409, json: { message: 'already exists' } }
      const tokens = ['tok1', 'tok2', 'tok3'].map((t) => `${t}${body.EmailIdentity.length}`)
      identities.set(body.EmailIdentity, { verified: false, tokens })
      return { status: 200, json: { DkimAttributes: { Tokens: tokens, Status: 'PENDING' }, VerifiedForSendingStatus: false } }
    }
    const domain = path.split('/').pop()!
    const id = identities.get(domain)
    if (method === 'GET' && id) {
      return { status: 200, json: { DkimAttributes: { Tokens: id.tokens, Status: id.verified ? 'SUCCESS' : 'PENDING' }, VerifiedForSendingStatus: id.verified } }
    }
    return { status: 404, json: { message: 'not found' } }
  }
  return { identities, calls, ses }
}

let txt: Record<string, string[][]> = {}
const resolveTxt = async (name: string) => txt[name] ?? []
const originalManaged = process.env.SENDING_MANAGED

beforeEach(() => {
  db.saveSendingDomains([])
  txt = {}
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

  it('adds the domain in SES and lists the records to add: DKIM, ownership and DMARC', async () => {
    const { ses, calls } = fakeSes()
    const d = await addSendingDomain('Acme.com', { ses, resolveTxt })
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/v2/email/identities', body: { EmailIdentity: 'acme.com' } })
    const records = dnsRecords(d)
    expect(records.filter((r) => r.type === 'CNAME').map((r) => [r.name, r.value])).toEqual([
      ['tok18._domainkey.acme.com', 'tok18.dkim.amazonses.com'],
      ['tok28._domainkey.acme.com', 'tok28.dkim.amazonses.com'],
      ['tok38._domainkey.acme.com', 'tok38.dkim.amazonses.com'],
    ])
    expect(records[3]).toMatchObject({ type: 'TXT', name: '_magpiecrm.acme.com', value: `magpiecrm-verification=${d.ownershipToken}` })
    expect(records[4]).toMatchObject({ type: 'TXT', name: '_dmarc.acme.com', optional: true })
    expect(d.ownershipToken).toMatch(/^[0-9a-f]{32}$/)
    expect(getSendingDomains().map((x) => x.domain)).toEqual(['acme.com'])
  })

  it('is ready only when SES has verified it and this workspace proved it owns it', async () => {
    const { ses, identities } = fakeSes()
    const d = await addSendingDomain('acme.com', { ses, resolveTxt })
    expect(canSendFrom('hello@acme.com')).toBe(false)

    identities.get('acme.com')!.verified = true
    await checkSendingDomain('acme.com', { ses, resolveTxt })
    expect(canSendFrom('hello@acme.com')).toBe(false) // no ownership record yet

    txt['_magpiecrm.acme.com'] = [['magpiecrm-verification=', d.ownershipToken]] // long TXT values arrive in pieces
    await checkSendingDomain('acme.com', { ses, resolveTxt })
    expect(canSendFrom('"Jo" <Hello@Acme.com>')).toBe(true)
    expect(canSendFrom('news@mail.acme.com')).toBe(true)
    expect(canSendFrom('hello@acme.co')).toBe(false)
    expect(canSendFrom('hello@notacme.com')).toBe(false)
  })

  it("doesn't let one workspace send as a domain another has verified in the shared SES account", async () => {
    const { ses, identities } = fakeSes()
    identities.set('acme.com', { verified: true, tokens: ['a', 'b', 'c'] }) // verified by someone else
    txt['_magpiecrm.acme.com'] = [['magpiecrm-verification=someone-elses-token']]
    const d = await addSendingDomain('acme.com', { ses, resolveTxt })
    expect(d.sesVerified).toBe(true)
    expect(d.ownershipVerified).toBe(false)
    expect(canSendFrom('ceo@acme.com')).toBe(false)
  })

  it('stops sending from a removed domain', async () => {
    const { ses, identities } = fakeSes()
    const d = await addSendingDomain('acme.com', { ses, resolveTxt })
    identities.get('acme.com')!.verified = true
    txt['_magpiecrm.acme.com'] = [[`magpiecrm-verification=${d.ownershipToken}`]]
    await checkSendingDomain('acme.com', { ses, resolveTxt })
    removeSendingDomain('acme.com')
    expect(canSendFrom('hello@acme.com')).toBe(false)
  })

  it('refuses unverified senders only when the host runs sending', () => {
    delete process.env.SENDING_MANAGED
    expect(() => requireSendingDomain('me@anything.test')).not.toThrow()
    process.env.SENDING_MANAGED = 'on'
    expect(() => requireSendingDomain('me@anything.test')).toThrow("anything.test isn't a verified sending domain yet")
  })
})
