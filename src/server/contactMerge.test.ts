import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Adding someone who's already a contact, on a real (scratch) database: CSV
// import, the create form and the copilot's addContacts all end up in the same
// write. It takes what they bring and leaves everything else about the contact.

const scratchDir = mkdtempSync(join(tmpdir(), 'contact-merge-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

vi.mock('./notify', () => ({ notify: () => {} }))

const { db } = await import('./db')
const emailService = await import('./emailService')
const { isUnconfirmedGuess } = await import('./prospecting/types')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const EMAIL = 'jane@acme.test'
const contact = () => db.data.contacts.find((c) => c.email === EMAIL)!

/** A contact as prospect search leaves them, with everything only it can fill in. */
function prospect() {
  db.data.contacts = db.data.contacts.filter((c) => c.email !== EMAIL)
  db.data.contacts.push({
    email: EMAIL,
    first_name: 'Jane',
    last_name: 'Doe',
    job_title: 'Head of Sales',
    company: 'Acme',
    status: 'subscribed',
    created_at: '2026-01-01T00:00:00.000Z',
    custom: { plan: 'Pro' },
    source: 'socialfetch',
    email_status: 'format_confirmed',
    linkedin_url: 'https://www.linkedin.com/in/jane',
    country: 'United Kingdom',
    notice_status: 'sent',
    signed_up_at: '2026-02-01T00:00:00.000Z',
    company_id: 'company-1',
  } as any)
}

const OWN_FIELDS = ['status', 'created_at', 'custom', 'source', 'email_status', 'linkedin_url', 'country', 'notice_status', 'signed_up_at', 'company_id'] as const

describe('adding someone who is already a contact', () => {
  let listId: number
  beforeEach(async () => {
    prospect()
    listId = (await emailService.createList(`List ${Math.random()}`)).id
  })

  it('keeps everything a CSV import has no column for', async () => {
    const before = { ...contact() }
    await emailService.addContactsToList(listId, [{ email: EMAIL, attributes: { FIRSTNAME: 'Janet' } } as any])
    for (const key of OWN_FIELDS) expect(contact()[key as keyof typeof before]).toEqual(before[key as keyof typeof before])
  })

  it('keeps it through the create form too', async () => {
    const before = { ...contact() }
    await emailService.createContact({ email: EMAIL, attributes: { JOB_TITLE: 'VP Sales' } })
    for (const key of OWN_FIELDS) expect(contact()[key as keyof typeof before]).toEqual(before[key as keyof typeof before])
  })

  it('takes what it brings', async () => {
    await emailService.addContactsToList(listId, [{ email: EMAIL, attributes: { FIRSTNAME: 'Janet', LASTNAME: 'Smith', JOB_TITLE: 'CEO', COMPANY: 'Globex' } } as any])
    expect(contact()).toMatchObject({ first_name: 'Janet', last_name: 'Smith', job_title: 'CEO', company: 'Globex' })
  })

  it("doesn't clear a value with a blank", async () => {
    await emailService.addContactsToList(listId, [{ email: EMAIL, attributes: { FIRSTNAME: '   ', COMPANY: '' } } as any])
    expect(contact()).toMatchObject({ first_name: 'Jane', last_name: 'Doe', job_title: 'Head of Sales', company: 'Acme' })
  })

  it('still knows a prospect from an opt-in afterwards', async () => {
    expect(isUnconfirmedGuess(contact() as any)).toBe(true)
    await emailService.addContactsToList(listId, [{ email: EMAIL, attributes: {} } as any])
    expect(isUnconfirmedGuess(contact() as any)).toBe(true)
  })

  it('leaves someone who unsubscribed unsubscribed', async () => {
    contact().status = 'unsubscribed'
    await emailService.addContactsToList(listId, [{ email: EMAIL, attributes: { FIRSTNAME: 'Janet' } } as any])
    expect(contact().status).toBe('unsubscribed')
  })

  it('still adds them to the list, once', async () => {
    await emailService.addContactsToList(listId, [{ email: EMAIL, attributes: {} } as any])
    await emailService.addContactsToList(listId, [{ email: EMAIL, attributes: {} } as any])
    expect(db.data.list_contacts.filter((lc) => lc.list_id === listId && lc.contact_email === EMAIL)).toHaveLength(1)
  })

  it('takes a country a CSV brings, in its one spelling', async () => {
    await emailService.addContactsToList(listId, [{ email: EMAIL, attributes: { COUNTRY: ' usa ' } } as any])
    expect(contact().country).toBe('United States')
  })

  it("keeps a country it doesn't know as it was typed", async () => {
    await emailService.addContactsToList(listId, [{ email: EMAIL, attributes: { COUNTRY: ' Portugal ' } } as any])
    expect(contact().country).toBe('Portugal')
  })

  it("doesn't clear a country with a blank", async () => {
    await emailService.addContactsToList(listId, [{ email: EMAIL, attributes: { COUNTRY: '  ' } } as any])
    expect(contact().country).toBe('United Kingdom')
  })

  it('gives a new contact their country', async () => {
    const email = `new-${Math.random()}@acme.test`
    await emailService.addContactsToList(listId, [{ email, attributes: { COUNTRY: 'UK' } } as any])
    expect(db.data.contacts.find((c) => c.email === email)?.country).toBe('United Kingdom')
  })

  it('still creates someone new', async () => {
    const email = `new-${Math.random()}@acme.test`
    await emailService.addContactsToList(listId, [{ email, attributes: { FIRSTNAME: 'Sam', JOB_TITLE: 'CTO' } } as any])
    expect(db.data.contacts.find((c) => c.email === email)).toMatchObject({ first_name: 'Sam', job_title: 'CTO', status: 'subscribed' })
  })
})
