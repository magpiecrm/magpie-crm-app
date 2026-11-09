import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The route imports db.ts, which reads DATABASE_PATH at module load.
const scratchDir = mkdtempSync(join(tmpdir(), 'form-submit-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { Route } = await import('./$formId')
const { db } = await import('../../../server/db')
const handlers = (Route as any).options.server.handlers

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const post = (body: unknown, opts: { form?: string; type?: string } = {}) =>
  handlers.POST({
    params: { formId: opts.form ?? 'f1' },
    request: new Request(`http://app.test/api/form-submit/${opts.form ?? 'f1'}`, {
      method: 'POST',
      headers: { origin: 'https://site.test', 'content-type': opts.type ?? 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  })

const baseForm = {
  id: 'f1', name: 'Contact', fields: ['first_name', 'email'], list_id: 1, save_to_list_enabled: true, save_to_list_fields: ['first_name', 'last_name', 'company'],
  welcome_email_enabled: false, welcome_email_subject: '', welcome_email_body: '', welcome_email_delay_minutes: 5, sender_id: null, created_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  db.data.forms = [structuredClone(baseForm)]
  db.data.form_submissions = []
  db.data.pending_emails = []
  db.data.contact_fields = [{ key: 'team_size', label: 'Team size', type: 'select', options: ['1-10', '11-50'], created_at: '' }]
  db.data.contacts = db.data.contacts.filter((c) => !c.email.endsWith('@site.test'))
})

describe('/api/form-submit', () => {
  it('takes what an old pasted snippet sends, and keeps it with the submission', async () => {
    const res = await post({ first_name: 'Priya', email: 'Priya@Site.test' })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://site.test')
    const sub = db.data.form_submissions![0]
    expect(sub.contact_email).toBe('priya@site.test')
    expect(sub.values).toEqual({ first_name: 'Priya', email: 'priya@site.test' })
    expect(db.getContact('priya@site.test')?.first_name).toBe('Priya')
    expect(db.data.list_contacts.some((lc) => lc.list_id === 1 && lc.contact_email === 'priya@site.test')).toBe(true)
  })

  it('refuses a missing required field and says which', async () => {
    const res = await post({ email: 'a@site.test' })
    expect(res.status).toBe(400)
    expect((await res.json()).problems).toEqual({ first_name: 'Enter your first name.' })
    expect(db.data.form_submissions).toHaveLength(0)
  })

  it("doesn't ask for a first name a form doesn't have", async () => {
    db.data.forms![0].fields = ['email']
    expect((await post({ email: 'b@site.test' })).status).toBe(200)
  })

  it('checks custom fields and writes them onto the contact', async () => {
    Object.assign(db.data.forms![0], { fields: ['email', 'custom:team_size'], save_to_list_fields: ['custom:team_size'], field_settings: { 'custom:team_size': { required: true } } })
    expect((await post({ email: 'c@site.test', 'custom:team_size': 'lots' })).status).toBe(400)
    expect((await post({ email: 'c@site.test', 'custom:team_size': '11-50' })).status).toBe(200)
    expect(db.getContact('c@site.test')?.custom?.team_size).toBe('11-50')
  })

  it('keeps the consent wording they agreed to', async () => {
    Object.assign(db.data.forms![0], { fields: ['email', 'consent'], field_settings: { consent: { label: 'Send me the newsletter' } } })
    expect((await post({ email: 'd@site.test' })).status).toBe(400)
    expect((await post({ email: 'd@site.test', consent: true })).status).toBe(200)
    expect(db.data.form_submissions![0].consent_text).toBe('Send me the newsletter')
  })

  it('thanks a bot that fills the hidden field, and keeps nothing', async () => {
    const res = await post({ first_name: 'Bot', email: 'bot@site.test', _magpie_hp: 'http://spam.test' })
    expect(res.status).toBe(200)
    expect(db.data.form_submissions).toHaveLength(0)
    expect(db.getContact('bot@site.test')).toBeFalsy()
  })

  it('refuses submissions while the form is paused', async () => {
    db.data.forms![0].paused = true
    expect((await post({ first_name: 'E', email: 'e@site.test' })).status).toBe(403)
  })

  it('sends a plain HTML form back to the hosted page', async () => {
    const res = await post('first_name=Fran&email=fran%40site.test', { type: 'application/x-www-form-urlencoded' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('http://app.test/f/f1?sent=1')
    expect(db.data.form_submissions![0].values?.first_name).toBe('Fran')
  })

  it("escapes what they typed in the welcome email, so a name can't add a link", async () => {
    Object.assign(db.data.forms![0], { welcome_email_enabled: true, welcome_email_subject: 'Hi {{first_name}}', welcome_email_body: 'Hello {{first_name}}' })
    await post({ first_name: '<a href="http://x.test">win</a>', email: 'g@site.test' })
    const mail = db.data.pending_emails!.at(-1)!
    expect(mail.html).toContain('&lt;a href=')
    expect(mail.html).not.toContain('<a href')
  })

  it("fills a contact's blanks but doesn't overwrite what they have", async () => {
    db.upsertContact('h@site.test', { builtin: { first_name: 'Harriet', company: '' } }, { create: true })
    Object.assign(db.data.forms![0], { fields: ['first_name', 'email', 'company'] })
    await post({ first_name: 'H', email: 'h@site.test', company: 'Hartley' })
    expect(db.getContact('h@site.test')).toMatchObject({ first_name: 'Harriet', company: 'Hartley' })
  })
})
