import { describe, expect, it } from 'vitest'
import { checkSubmission, contactFieldsOf, fillMergeTags, publicForm, resolveFields, submissionValue, type FormRecord } from './model'
import { iframeSnippet, layoutRows, plainHtmlSnippet, textOn } from './render'
import type { ContactFieldDef } from '../contacts/contactFields'

const teamSize: ContactFieldDef = { key: 'team_size', label: 'Team size', type: 'select', options: ['1-10', '11-50'], created_at: '' }
const legacy = { fields: ['first_name', 'email'] }

describe('resolveFields', () => {
  it('reads a form from before fields could be changed as it always worked', () => {
    const fields = resolveFields(legacy, [])
    expect(fields.map((f) => [f.key, f.label, f.required, f.type])).toEqual([
      ['first_name', 'First name', true, 'text'],
      ['email', 'Email', true, 'email'],
    ])
  })

  it('puts email on a form that somehow lacks it, and drops a deleted custom field', () => {
    expect(resolveFields({ fields: ['company', 'custom:gone'] }, []).map((f) => f.key)).toEqual(['email', 'company'])
  })

  it('takes labels and required from the settings, but email stays required', () => {
    const fields = resolveFields(
      { fields: ['email', 'custom:team_size', 'consent'], field_settings: { email: { required: false }, 'custom:team_size': { label: 'Size', required: true }, consent: { required: false } } },
      [teamSize],
    )
    expect(fields.map((f) => [f.key, f.label, f.required, f.type, f.contact])).toEqual([
      ['email', 'Email', true, 'email', true],
      ['custom:team_size', 'Size', true, 'select', true],
      ['consent', 'I agree to receive emails. I can unsubscribe at any time.', false, 'checkbox', false],
    ])
  })
})

describe('checkSubmission', () => {
  const fields = resolveFields({ fields: ['first_name', 'email', 'custom:team_size', 'message'], field_settings: { 'custom:team_size': { required: true } } }, [teamSize])

  it('says what is missing or wrong, by field', () => {
    const r = checkSubmission(fields, { email: 'nope', 'custom:team_size': 'lots' }, [teamSize])
    expect(r).toEqual({
      ok: false,
      problems: { first_name: 'Enter your first name.', email: 'Enter an email address like name@company.com.', 'custom:team_size': expect.stringContaining('Team size') },
    })
  })

  it('cleans what it keeps, and ignores keys the form does not have', () => {
    const r = checkSubmission(fields, { first_name: '  Priya ', email: 'Priya@Example.COM', 'custom:team_size': '11-50', is_admin: 'yes' }, [teamSize])
    expect(r).toEqual({ ok: true, email: 'priya@example.com', values: { first_name: 'Priya', email: 'priya@example.com', 'custom:team_size': '11-50' }, custom: { team_size: '11-50' } })
  })

  it('needs a required tick box ticked', () => {
    const consent = resolveFields({ fields: ['email', 'consent'] }, [])
    expect(checkSubmission(consent, { email: 'a@b.co', consent: 'on' }, [])).toMatchObject({ ok: true, values: { consent: true } })
    expect(checkSubmission(consent, { email: 'a@b.co' }, [])).toMatchObject({ ok: false, problems: { consent: 'Tick this to continue.' } })
  })
})

describe('submissionValue', () => {
  it('shows what was sent, or for an older submission what the contact holds', () => {
    const contact = { first_name: 'Now', company: 'Acme' }
    expect(submissionValue({ form_id: 'f', contact_email: 'a@b.co', submitted_at: '', values: { first_name: 'Then' } }, 'first_name')).toBe('Then')
    expect(submissionValue({ form_id: 'f', contact_email: 'a@b.co', submitted_at: '', values: {}, contact } as never, 'company')).toBe('')
    expect(submissionValue({ form_id: 'f', contact_email: 'a@b.co', submitted_at: '', message: 'Hi', contact } as never, 'company')).toBe('Acme')
    expect(submissionValue({ form_id: 'f', contact_email: 'a@b.co', submitted_at: '', message: 'Hi' }, 'message')).toBe('Hi')
  })
})

describe('what a form writes to the contact', () => {
  it('is first name, last name and company on older forms, never email, message or consent', () => {
    expect(contactFieldsOf({ fields: ['first_name', 'email', 'message'] })).toEqual(['first_name'])
    expect(contactFieldsOf({ fields: ['email', 'consent', 'job_title'], save_to_list_fields: ['job_title', 'consent', 'email'] })).toEqual(['job_title'])
  })
})

describe('rendering', () => {
  const form = publicForm({ id: 'f1', name: 'Say "hi" <now>', fields: ['first_name', 'last_name', 'email'], submit_label: 'Go & send' } as FormRecord, [])

  it('puts first and last name side by side', () => {
    expect(layoutRows(form.fields).map((r) => r.map((f) => f.key))).toEqual([['first_name', 'last_name'], ['email']])
  })

  it('escapes what the owner typed in the HTML snippet', () => {
    const html = plainHtmlSnippet(form, 'https://app.test')
    expect(html).toContain('>Go &amp; send</button>')
    expect(html).toContain('action="https://app.test/api/form-submit/f1"')
    expect(iframeSnippet('f1', 'https://app.test', form.name)).toContain('title="Say &quot;hi&quot; &lt;now&gt;"')
  })

  it('keeps the button text readable on its colour', () => {
    expect(textOn('#111827')).toBe('#ffffff')
    expect(textOn('#fde047')).toBe('#111827')
  })

  it('fills a welcome email, escaping what the visitor typed when it is HTML', () => {
    expect(fillMergeTags('Hi {{first_name}}{{ missing }}', { first_name: '<b>Ann</b>' })).toBe('Hi <b>Ann</b>')
    expect(fillMergeTags('Hi {{first_name}}', { first_name: '<b>Ann</b>' }, { html: true })).toBe('Hi &lt;b&gt;Ann&lt;/b&gt;')
  })
})
