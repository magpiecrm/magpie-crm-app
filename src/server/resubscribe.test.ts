import { beforeEach, describe, expect, it, vi } from 'vitest'

// Resubscribing is the only path in the app that can override an unsubscribe,
// so these pin down that it stays narrow: one contact, status only, nothing
// created, nothing else touched.

type Contact = { email: string; status: string }
const state: { contacts: Contact[]; runs: Array<{ sql: string; params: any[] }> } = {
  contacts: [],
  runs: [],
}

vi.mock('./db', () => ({
  db: {
    get data() { return { contacts: state.contacts, list_contacts: [] } },
    run: (sql: string, params: any[] = []) => {
      state.runs.push({ sql, params })
      if (sql.startsWith('UPDATE contacts SET status = ? WHERE email = ?')) {
        const c = state.contacts.find((x) => x.email === params[1])
        if (c) c.status = params[0]
      }
    },
    query: () => ({ all: () => [], get: () => null }),
    prepare: () => ({ run: () => {} }),
  },
}))
vi.mock('./nodemailer', () => ({ sendMail: vi.fn() }))
vi.mock('./notify', () => ({ notify: vi.fn() }))
vi.mock('./crypto', () => ({ encryptToken: () => 'tok' }))

const { resubscribeContact } = await import('./emailService')

beforeEach(() => {
  state.contacts = [
    { email: 'gone@b.com', status: 'unsubscribed' },
    { email: 'bounced@b.com', status: 'bounced' },
    { email: 'fine@b.com', status: 'subscribed' },
  ]
  state.runs = []
})

describe('resubscribeContact', () => {
  it('restores an unsubscribed contact and reports the previous status', async () => {
    const res = await resubscribeContact('gone@b.com')
    expect(res).toEqual({ success: true, previousStatus: 'unsubscribed', changed: true })
    expect(state.contacts.find((c) => c.email === 'gone@b.com')!.status).toBe('subscribed')
  })

  it('restores a bounced contact too', async () => {
    const res = await resubscribeContact('bounced@b.com')
    expect(res.previousStatus).toBe('bounced')
    expect(state.contacts.find((c) => c.email === 'bounced@b.com')!.status).toBe('subscribed')
  })

  it('is a no-op for an already subscribed contact, with no write', async () => {
    const res = await resubscribeContact('fine@b.com')
    expect(res).toEqual({ success: true, previousStatus: 'subscribed', changed: false })
    expect(state.runs).toHaveLength(0)
  })

  it('normalizes case and whitespace', async () => {
    await resubscribeContact('  GONE@B.com  ')
    expect(state.contacts.find((c) => c.email === 'gone@b.com')!.status).toBe('subscribed')
  })

  it('refuses an unknown email rather than creating a contact', async () => {
    await expect(resubscribeContact('nobody@b.com')).rejects.toThrow(/No contact found/)
    expect(state.contacts).toHaveLength(3)
    expect(state.runs).toHaveLength(0)
  })

  it('touches only the one contact, and only its status', async () => {
    const before = JSON.stringify(state.contacts.filter((c) => c.email !== 'gone@b.com'))
    await resubscribeContact('gone@b.com')

    // Every other contact is untouched...
    expect(JSON.stringify(state.contacts.filter((c) => c.email !== 'gone@b.com'))).toBe(before)
    // ...and the only write issued is the single status update.
    expect(state.runs).toHaveLength(1)
    expect(state.runs[0].sql).toBe('UPDATE contacts SET status = ? WHERE email = ?')
    expect(state.runs[0].params).toEqual(['subscribed', 'gone@b.com'])
  })
})
