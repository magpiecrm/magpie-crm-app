import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Inbox warmup in a hosted copy, against a fake host: which senders can warm
// and why not, what's sent when one starts (and only once someone agreed),
// and an inbox reconnected or disconnected passed on.

const scratchDir = mkdtempSync(join(tmpdir(), 'inbox-warmup-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
Object.assign(process.env, { SENDING_MANAGED: 'on', PROSPECTING_MANAGED: 'on', REACHER_URL: 'https://services.magpie.test', REACHER_SECRET: 'vt_mc_acme' })

const { db } = await import('./db')
const { encryptToken } = await import('./crypto')
const { env } = await import('./env')
const { refreshHostRules } = await import('./prospecting/hostRules')
const warmup = await import('./inboxWarmup')

afterAll(() => {
  vi.unstubAllGlobals()
  for (const k of ['DATABASE_PATH', 'SENDING_MANAGED', 'PROSPECTING_MANAGED', 'REACHER_URL', 'REACHER_SECRET', 'MANAGED_BILLING_URL']) delete process.env[k]
  rmSync(scratchDir, { recursive: true, force: true })
})

/** The host's answer to /v1/prospecting, with or without warmup offered. */
async function hostOffers(offered: boolean) {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ rules: {}, ...(offered ? { inboxWarmup: { available: true, maxSenders: 3, signal: null } } : {}) })))
  await refreshHostRules()
}

/** A fake host's warmup service: what it was asked, and its answer. */
function fakeHost(view: any = { available: true, stopped: null, maxSenders: 3, senders: [], placementTests: { used: 0, limit: 2 } }) {
  const calls: Array<{ method: string; path: string; body?: any }> = []
  return {
    calls,
    host: async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body })
      if (method === 'GET' && path === '') return { status: 200, json: view }
      if (method === 'DELETE') return { status: 204, json: null }
      return { status: 200, json: { address: 'sales@acme.test', state: 'starting' } }
    },
  }
}

let hour = 0
/** DNS with SPF and DMARC unless told otherwise; a later hour each time, so nothing's remembered between tests. */
const deps = (fake: ReturnType<typeof fakeHost>, dns: { spf?: boolean; dmarc?: boolean } = {}) => ({
  host: fake.host,
  now: () => new Date(Date.UTC(2026, 10, 3, hour)),
  resolveTxt: async (name: string) =>
    name.startsWith('_dmarc.') ? (dns.dmarc === false ? [] : [['v=DMARC1; p=none']]) : dns.spf === false ? [['google-site-verification=x']] : [['v=spf1 include:_spf.google.com ~all']],
})

beforeEach(async () => {
  hour++
  await hostOffers(true)
  db.mutate((d) => {
    d.senders = [{ id: 1, name: 'Sales', email: 'sales@acme.test' } as any, { id: 2, name: 'Jo', email: 'jo@other.test' } as any]
    d.mailboxes = [
      {
        id: 'm1', sender_id: 1, host: 'imap.gmail.com', port: 993, secure: true, user: 'sales@acme.test',
        secret: encryptToken({ password: 'app-password' }, env.credentialsSecret()), status: 'ok', last_error: null, error_since: null,
        last_polled_at: null, folder: 'INBOX', uid_validity: null, last_uid: null, replies_found: 0, created_at: '', updated_at: '',
      },
    ]
    d.warmup_consents = []
  })
  db.saveSendingDomains([{ domain: 'acme.test', records: [], ready: true, addedAt: '2026-11-01T00:00:00Z', checkedAt: null } as any])
})

describe('inbox warmup', () => {
  it("isn't there unless the host offers it", async () => {
    await hostOffers(false)
    expect(await warmup.warmupPage(deps(fakeHost()))).toEqual({ offered: false })
  })

  it("offers to add it to the plan where it's for sale but not on the plan", async () => {
    const forSale = { available: false, purchasable: { price: '£5', perDay: 20 } }
    process.env.MANAGED_BILLING_URL = 'https://services.magpie.test/v1/billing/acme'
    try {
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ rules: {}, inboxWarmup: forSale })))
      await refreshHostRules()
      const fake = fakeHost()
      expect(await warmup.warmupPage(deps(fake))).toEqual({ offered: false, purchasable: { price: '£5', perDay: 20 } })
      // Nothing can start, and the warmup service isn't asked.
      await expect(warmup.startWarmup(1, 'owner@acme.test', deps(fake))).rejects.toThrow(/isn't offered/)
      expect(fake.calls).toEqual([])
      // Taken off the plan since the host's rules were last asked: its warmup service says so.
      await hostOffers(true)
      expect(await warmup.warmupPage(deps(fakeHost(forSale)))).toEqual({ offered: false, purchasable: { price: '£5', perDay: 20 } })
      // Where the host doesn't bill for this copy there's no plan to add it to.
      delete process.env.MANAGED_BILLING_URL
      expect(await warmup.warmupPage(deps(fakeHost(forSale)))).toEqual({ offered: false })
    } finally {
      delete process.env.MANAGED_BILLING_URL
    }
  })

  it("says why each sender can't warm yet", async () => {
    const rows = await warmup.eligibility(deps(fakeHost()))
    expect(rows.find((r) => r.senderId === 1)!.blockers).toEqual([])
    // Another domain, not ready, with no inbox connected.
    expect(rows.find((r) => r.senderId === 2)!.blockers).toEqual([
      "other.test isn't ready to send from yet: finish it under Settings → Sending.",
      "Connect this sender's inbox first, under Settings → Mailboxes.",
    ])
    hour++
    const noDns = await warmup.eligibility(deps(fakeHost(), { spf: false, dmarc: false }))
    expect(noDns.find((r) => r.senderId === 1)!.blockers).toEqual([
      'acme.test has no SPF record. Add the one your mail provider gives you to its DNS.',
      'acme.test has no DMARC record. Add the one shown under Settings → Sending.',
    ])
    // Someone else's inbox, or one whose login is refused, won't do. (DNS is looked up again after 10 minutes.)
    hour++
    db.mutate((d) => (d.mailboxes![0].user = 'someone@acme.test'))
    expect((await warmup.eligibility(deps(fakeHost()))).find((r) => r.senderId === 1)!.blockers).toEqual([
      'Its connected inbox is someone@acme.test: warmup needs sales@acme.test\'s own inbox.',
    ])
  })

  it('starts a sender once someone agrees, sending its inbox login and the consent, and records who agreed', async () => {
    const fake = fakeHost()
    await warmup.startWarmup(1, 'owner@acme.test', deps(fake))
    const put = fake.calls.find((c) => c.method === 'PUT')!
    expect(put.path).toBe('/senders/sales%40acme.test')
    expect(put.body).toMatchObject({
      name: 'Sales',
      imap: { host: 'imap.gmail.com', port: 993, secure: true, user: 'sales@acme.test', password: 'app-password' },
      consent: { version: warmup.CONSENT_VERSION, by: 'owner@acme.test' },
    })
    expect(db.data.warmup_consents).toEqual([{ address: 'sales@acme.test', at: expect.any(String), by: 'owner@acme.test', version: warmup.CONSENT_VERSION }])
    // One that can't warm yet isn't sent at all.
    await expect(warmup.startWarmup(2, 'owner@acme.test', deps(fake))).rejects.toThrow(/isn't ready to send from/)
    expect(fake.calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
  })

  it("passes a warming sender's new inbox login on, and stops its warmup when the inbox is disconnected", async () => {
    const fake = fakeHost()
    // Not warming: nothing to pass on.
    await warmup.inboxChanged(1, true, deps(fake))
    expect(fake.calls).toEqual([])
    db.mutate((d) => (d.warmup_consents = [{ address: 'sales@acme.test', at: '2026-11-03T00:00:00Z', by: 'owner@acme.test', version: warmup.CONSENT_VERSION }]))
    db.mutate((d) => (d.mailboxes![0].secret = encryptToken({ password: 'new-app-password' }, env.credentialsSecret())))
    await warmup.inboxChanged(1, true, deps(fake))
    expect(fake.calls.at(-1)).toMatchObject({ method: 'PUT', body: { imap: { password: 'new-app-password' }, consent: { by: 'owner@acme.test' } } })
    await warmup.inboxChanged(1, false, deps(fake))
    expect(fake.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/senders/sales%40acme.test' })
    expect(db.data.warmup_consents).toEqual([])
  })

  it("shows each sender with its warmup from the host, and the senders still when the host can't be reached", async () => {
    const sender = { address: 'sales@acme.test', state: 'warming', pausedBy: null, reason: null, health: { state: 'healthy', score: 92, reason: null, until: null } }
    const page = await warmup.warmupPage(deps(fakeHost({ available: true, stopped: null, maxSenders: 3, senders: [sender], placementTests: { used: 1, limit: 2 } })))
    // A host from before sender checks says nothing of the last one.
    expect(page).toMatchObject({ offered: true, maxSenders: 3, placementTests: { used: 1, limit: 2, last: null }, consent: { version: warmup.CONSENT_VERSION } })
    if (!page.offered) throw new Error('offered')
    expect(page.senders.map((s) => [s.email, s.warmup?.state ?? null])).toEqual([['sales@acme.test', 'warming'], ['jo@other.test', null]])
    const down = await warmup.warmupPage({ ...deps(fakeHost()), host: async () => ({ status: 503, json: { error: "The warmup pool couldn't be reached." } }) })
    expect(down).toMatchObject({ offered: true, error: "The warmup pool couldn't be reached." })
  })

  it("asks the host for the month's sender check from a sender, and only where warmup is offered", async () => {
    const fake = fakeHost()
    await warmup.startSenderCheck('Sales@acme.test', deps(fake))
    expect(fake.calls.at(-1)).toEqual({ method: 'POST', path: '/sender-check', body: { address: 'sales@acme.test' } })
    await hostOffers(false)
    await expect(warmup.startSenderCheck('sales@acme.test', deps(fake))).rejects.toThrow("aren't available")
  })
})
