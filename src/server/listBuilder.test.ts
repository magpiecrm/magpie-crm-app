import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ContactFilter } from '../features/contacts/contactFilters'

// Lists built from filters, on a real (scratch) database. What matters most is
// what can go wrong quietly: picking more people than were asked for, a preview
// promising something the write doesn't do, or a refresh undoing a decision.

const scratchDir = mkdtempSync(join(tmpdir(), 'list-builder-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')
process.env.PUBLIC_URL = 'https://example.test'

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({ messageId: 'x' })) }))
vi.mock('./nodemailer', () => ({ sendMail }))
vi.mock('./notify', () => ({ notify: () => {} }))

const { db } = await import('./db')
const emailService = await import('./emailService')
const { addNewMatches, buildList, listFieldInfo, previewList, previewNewMatches } = await import('./listBuilder')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const f = (field: string, op: ContactFilter['op'], value = '', values?: string[]): ContactFilter => ({ id: field + op, field, op, value, ...(values ? { values } : {}) })
const anyOf = (field: string, ...values: string[]) => f(field, field === 'job_title' ? 'contains_any' : 'is_any', '', values)
const members = (id: number) =>
  db.data.list_contacts
    .filter((lc) => lc.list_id === id)
    .map((lc) => lc.contact_email.split('@')[0])
    .sort()
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function person(name: string, fields: Record<string, unknown> = {}) {
  db.data.contacts.push({ email: `${name}@${name}.test`, first_name: name, last_name: '', job_title: '', company: '', status: 'subscribed', created_at: '2026-01-01T00:00:00.000Z', company_id: null, ...fields } as any)
}

let campaignId = 100
function emailed(name: string, fields: Record<string, unknown> = {}, campaign: Record<string, unknown> = {}) {
  const id = ++campaignId
  db.data.campaigns.push({ id, name: `Campaign ${id}`, status: 'sent', sent_at: daysAgo(5), ...campaign } as any)
  db.data.campaign_recipients.push({ campaign_id: id, contact_email: `${name}@${name}.test`, status: 'sent', opened_at: null, clicked_at: null, sent_at: daysAgo(5), ...fields } as any)
}

beforeEach(() => {
  db.data.contacts = []
  db.data.list_contacts = []
  db.data.lists = [{ id: 1, name: 'Default', created_at: '' }]
  db.data.campaigns = []
  db.data.campaign_recipients = []
  db.data.companies = []
  db.data.prospect_companies = []
  db.data.sequences = []
  db.data.sequence_enrollments = []
  db.data.mailboxes = []
  db.data.contact_fields = []
  db.data.suppression = []
  sendMail.mockClear()
  person('ana', { job_title: 'CEO', country: 'United Kingdom' })
  person('ben', { job_title: 'Founder', country: 'Germany' })
  person('cat', { job_title: 'Director of Sales', country: 'United Kingdom' })
  person('dan', { job_title: 'CTO', country: 'France' })
  person('eve', {})
})

describe('building a list from filters', () => {
  it('makes a normal list of who matches, combining fields', () => {
    const { id, matched } = buildList({ name: 'UK leaders', filters: [anyOf('country', 'United Kingdom', 'Germany'), anyOf('job_title', 'CEO', 'Founder')] })
    expect(matched).toBe(2)
    expect(members(id)).toEqual(['ana', 'ben'])
    expect(db.data.lists.find((l) => l.id === id)?.name).toBe('UK leaders')
  })

  it('remembers the filters, with their names', () => {
    const { id } = buildList({ name: 'UK', filters: [anyOf('country', 'United Kingdom')] })
    expect(db.data.lists.find((l) => l.id === id)?.built_from).toMatchObject({ filters: [{ field: 'country', label: 'Country', values: ['United Kingdom'] }], refreshed_at: null, removed: [] })
  })

  it("doesn't find a CTO in every Director", () => {
    expect(members(buildList({ name: 'Tech', filters: [anyOf('job_title', 'CTO')] }).id)).toEqual(['dan'])
  })

  it('saves once, however many it adds', () => {
    const save = vi.spyOn(db as any, 'save')
    buildList({ name: 'Everyone with a title', filters: [f('job_title', 'not_empty')] })
    expect(save).toHaveBeenCalledTimes(1)
    save.mockRestore()
  })

  it('comes through a save', () => {
    const { id } = buildList({ name: 'UK', filters: [anyOf('country', 'United Kingdom')] })
    const saved = JSON.parse(readFileSync(process.env.DATABASE_PATH!, 'utf8'))
    expect(saved.lists.find((l: any) => l.id === id).built_from.filters).toHaveLength(1)
    expect(saved.list_contacts.filter((lc: any) => lc.list_id === id)).toHaveLength(2)
  })

  it('needs a name, and someone to put on it', () => {
    expect(() => buildList({ name: '  ', filters: [anyOf('country', 'Germany')] })).toThrow('name')
    expect(() => buildList({ name: 'Nobody', filters: [anyOf('country', 'Spain')] })).toThrow('No contacts match')
    expect(db.data.lists).toHaveLength(1)
  })
})

describe('never picking everyone by mistake', () => {
  const count = () => [db.data.lists.length, db.data.list_contacts.length]

  it.each([
    ['no filters', [] as ContactFilter[], 'at least one filter'],
    ['a filter still waiting for a value', [anyOf('country')], 'still needs a value'],
    ['a filter with only blank values', [anyOf('country', '  ')], 'still needs a value'],
    ['a field that does not exist', [f('nothing', 'is', 'x')], "doesn't exist"],
    ['a comparison the field does not have', [f('country', 'more_than', '1')], "can't be compared"],
    ['a bad date', [f('created_at', 'on_or_after', 'soon')], 'valid date'],
    ['a bad number of days', [f('opened', 'in_last_days', '0')], 'number of days'],
    ['a good filter with a bad one', [anyOf('country', 'Germany'), f('nothing', 'is', 'x')], "doesn't exist"],
  ])('refuses %s, and changes nothing', (_, filters, message) => {
    const before = count()
    expect(() => previewList(filters)).toThrow(message)
    expect(() => buildList({ name: 'x', filters })).toThrow(message)
    expect(count()).toEqual(before)
  })

  it('allows what really does pick everyone, and says so', () => {
    expect(previewList([f('email', 'not_empty')])).toMatchObject({ matched: 5, everyone: true })
    expect(previewList([anyOf('country', 'Germany')]).everyone).toBe(false)
  })
})

describe('the preview', () => {
  it('writes nothing', () => {
    const save = vi.spyOn(db as any, 'save')
    previewList([anyOf('country', 'Germany')])
    previewList([anyOf('country', 'Germany')])
    expect(db.data.lists).toHaveLength(1)
    expect(save).not.toHaveBeenCalled()
    save.mockRestore()
  })

  it('adds everyone who matches, and says who a send would leave out', () => {
    db.data.contacts.find((c) => c.first_name === 'ana')!.status = 'unsubscribed'
    db.data.contacts.find((c) => c.first_name === 'cat')!.status = 'bounced'
    const filters = [anyOf('country', 'United Kingdom', 'Germany')]
    expect(previewList(filters)).toMatchObject({ matched: 3, toAdd: 3, canEmail: 1, wontEmail: { unsubscribed: 1, bounced: 1, opted_out: 0 } })
    expect(members(buildList({ name: 'x', filters }).id)).toEqual(['ana', 'ben', 'cat'])
  })

  it('says how many were left out for having nothing in the field', () => {
    expect(previewList([anyOf('country', 'Germany')]).blanks).toEqual([{ label: 'Country', count: 1, included: false }])
  })

  it('says how many are in only because they have nothing in the field', () => {
    expect(previewList([f('country', 'is_none', '', ['Germany'])]).blanks).toEqual([{ label: 'Country', count: 1, included: true }])
  })

  it("promises what a send actually does", async () => {
    db.data.senders = [{ id: 1, name: 'Acme', email: 'hi@acme.test' }]
    db.data.contacts.find((c) => c.first_name === 'ana')!.status = 'unsubscribed'
    db.data.contacts.find((c) => c.first_name === 'cat')!.status = 'bounced'
    const filters = [f('email', 'not_empty')]
    const { canEmail } = previewList(filters)
    const { id } = buildList({ name: 'Everyone', filters })
    const { id: campaign } = await emailService.createCampaign({ name: 'Launch', subject: 'Hello', htmlContent: '<p>Hi</p>', sender: { name: 'Acme', email: 'hi@acme.test' }, recipients: { listIds: [id] } })
    await emailService.sendCampaign(campaign)
    expect(canEmail).toBe(3)
    expect(sendMail).toHaveBeenCalledTimes(canEmail)
  })
})

describe('adding new matches', () => {
  const built = () => buildList({ name: 'UK', filters: [anyOf('country', 'United Kingdom')] }).id

  it('adds who has come to match since, and says when', () => {
    const id = built()
    person('fay', { country: 'United Kingdom' })
    expect(previewNewMatches(id)).toMatchObject({ matched: 3, alreadyOn: 2, toAdd: 1 })
    expect(members(id)).toEqual(['ana', 'cat'])
    addNewMatches(id)
    expect(members(id)).toEqual(['ana', 'cat', 'fay'])
    expect(db.data.lists.find((l) => l.id === id)?.built_from?.refreshed_at).toBeTruthy()
  })

  it('takes nobody off, even someone who stopped matching', () => {
    const id = built()
    db.data.contacts.find((c) => c.first_name === 'ana')!.country = 'Spain'
    addNewMatches(id)
    expect(members(id)).toEqual(['ana', 'cat'])
  })

  it('adds nobody twice', () => {
    const id = built()
    addNewMatches(id)
    addNewMatches(id)
    expect(members(id)).toEqual(['ana', 'cat'])
  })

  it('leaves someone taken off by hand off, and says so', async () => {
    const id = built()
    await emailService.removeContactFromList(id, 'ANA@ana.test ')
    expect(members(id)).toEqual(['cat'])
    expect(previewNewMatches(id)).toMatchObject({ matched: 2, alreadyOn: 1, removedByHand: 1, toAdd: 0 })
    addNewMatches(id)
    expect(members(id)).toEqual(['cat'])
  })

  it('remembers that only on lists built from filters', async () => {
    const { id } = await emailService.createList('By hand')
    await emailService.addContactsToList(id, [{ email: 'ana@ana.test', attributes: {} } as any])
    await emailService.removeContactFromList(id, 'ana@ana.test')
    expect(members(id)).toEqual([])
    expect(db.data.lists.find((l) => l.id === id)?.built_from).toBeUndefined()
  })

  it('keeps no address for someone who stops being a contact', async () => {
    const id = built()
    await emailService.removeContactFromList(id, 'ana@ana.test')
    await emailService.deleteContacts(['ana@ana.test'])
    expect(db.data.lists.find((l) => l.id === id)?.built_from?.removed).toEqual([])
  })

  it('shows how a list was built, and how many came off, but not who', async () => {
    const id = built()
    await emailService.removeContactFromList(id, 'ana@ana.test')
    const { lists } = await emailService.getLists()
    const list = lists.find((l: any) => l.id === id)
    expect(list.builtFrom).toMatchObject({ refreshedAt: null, removedCount: 1, filters: [{ label: 'Country' }] })
    expect(JSON.stringify(list)).not.toContain('ana@')
    expect(lists.find((l: any) => l.id === 1).builtFrom).toBeNull()
  })

  it("won't run without all its filters, as dropping one would pick more people", () => {
    db.data.contact_fields = [{ key: 'plan', label: 'Plan', type: 'select', options: ['Pro'], created_at: '' }] as any
    db.data.contacts.find((c) => c.first_name === 'ana')!.custom = { plan: 'Pro' }
    const { id } = buildList({ name: 'Pro in the UK', filters: [anyOf('country', 'United Kingdom'), f('custom:plan', 'is', 'Pro')] })
    expect(members(id)).toEqual(['ana'])
    db.data.contact_fields = []
    expect(() => previewNewMatches(id)).toThrow('"Plan" field doesn\'t exist')
    expect(() => addNewMatches(id)).toThrow('"Plan" field doesn\'t exist')
    expect(members(id)).toEqual(['ana'])
    expect(db.data.lists.find((l) => l.id === id)?.built_from?.refreshed_at).toBeNull()
  })

  it('needs a list built from filters', async () => {
    const { id } = await emailService.createList('By hand')
    expect(() => addNewMatches(id)).toThrow("wasn't built from filters")
    expect(() => addNewMatches(9999)).toThrow("doesn't exist")
  })
})

describe('filtering on what the workspace knows beyond the contact', () => {
  it('works seniority out from the title', () => {
    expect(members(buildList({ name: 'x', filters: [anyOf('seniority', 'c_suite')] }).id)).toEqual(['ana', 'dan'])
    expect(members(buildList({ name: 'y', filters: [anyOf('seniority', 'founder')] }).id)).toEqual(['ben'])
  })

  it("takes company size and industry from the contact's company", () => {
    db.data.companies = [{ id: 'c1', name: 'Acme', domain: 'ana.test', headcount: 30, industry: 'Software' }, { id: 'c2', name: 'Big', domain: 'ben.test', headcount: 900, industry: null }] as any
    db.data.contacts.find((c) => c.first_name === 'ana')!.company_id = 'c1'
    db.data.contacts.find((c) => c.first_name === 'ben')!.company_id = 'c2'
    expect(members(buildList({ name: 'x', filters: [anyOf('company_size', '11-50')] }).id)).toEqual(['ana'])
    expect(members(buildList({ name: 'y', filters: [anyOf('industry', 'Software')] }).id)).toEqual(['ana'])
  })

  it('falls back on the staff count prospect search learnt', () => {
    db.data.companies = [{ id: 'c1', name: 'Acme', domain: 'ana.test', headcount: null, industry: null }] as any
    db.data.prospect_companies = [{ ref: 'r', name: 'Acme', domain: 'ana.test', headcount: 300 }] as any
    db.data.contacts.find((c) => c.first_name === 'ana')!.company_id = 'c1'
    expect(previewList([anyOf('company_size', '201-500')]).matched).toBe(1)
  })

  it('offers those fields to the builder, with no way to read a contact', () => {
    const fields = listFieldInfo()
    expect(fields.map((x) => x.key)).toEqual(expect.arrayContaining(['seniority', 'company_size', 'industry', 'opened', 'clicked', 'replied', 'country', 'job_title']))
    expect(JSON.stringify(fields)).not.toContain('@')
    expect(fields.every((x) => !('value' in x))).toBe(true)
    expect(fields.find((x) => x.key === 'replied')?.hint).toContain('sequence emails')
  })
})

describe('filtering on engagement', () => {
  const who = (field: string, op: ContactFilter['op'], days = '30') => {
    const filters = [f(field, op, days)]
    return previewList(filters).matched === 0 ? [] : members(buildList({ name: `x${Math.random()}`, filters }).id)
  }

  it('counts an open in the window', () => {
    emailed('ana', { opened_at: daysAgo(3) })
    emailed('ben', { opened_at: daysAgo(40) })
    expect(who('opened', 'in_last_days')).toEqual(['ana'])
  })

  it('uses the latest open', () => {
    emailed('ana', { opened_at: daysAgo(40), last_opened_at: daysAgo(2) })
    expect(who('opened', 'in_last_days')).toEqual(['ana'])
  })

  it('counts a click as an open, as images may be off', () => {
    emailed('ana', { clicked_at: daysAgo(3) })
    expect(who('opened', 'in_last_days')).toEqual(['ana'])
  })

  it('leaves out loads and clicks judged automated', () => {
    emailed('ana', { bot_opens: 5, bot_clicks: 3, opens: 0, clicks: 0 })
    expect(who('opened', 'in_last_days')).toEqual([])
    expect(who('clicked', 'in_last_days')).toEqual([])
  })

  it("says someone didn't open only if they had an email they could have", () => {
    emailed('ana', { opened_at: null })
    emailed('ben', { opened_at: daysAgo(2) })
    expect(who('opened', 'not_in_last_days')).toEqual(['ana'])
  })

  it("doesn't count someone never emailed, or an email from before the window", () => {
    emailed('ana', { sent_at: daysAgo(60) }, { sent_at: daysAgo(60) })
    expect(who('opened', 'not_in_last_days')).toEqual([])
  })

  it("doesn't count an email that bounced as a chance to open it", () => {
    emailed('ana', { status: 'bounced_hard' })
    expect(who('opened', 'not_in_last_days')).toEqual([])
  })

  it("doesn't count a campaign that tracked no opens, but still believes a click in one", () => {
    emailed('ana', {}, { track_opens: false })
    emailed('ben', { clicked_at: daysAgo(2) }, { track_opens: false })
    expect(who('opened', 'not_in_last_days')).toEqual([])
    expect(who('opened', 'in_last_days')).toEqual(['ben'])
  })

  it('uses the sent time of an older row with none of its own', () => {
    emailed('ana', { sent_at: undefined }, { sent_at: daysAgo(4) })
    expect(who('clicked', 'not_in_last_days')).toEqual(['ana'])
  })

  describe('in sequences', () => {
    const sequence = (settings: Record<string, unknown> = {}) => {
      db.data.sequences = [{ id: 's1', sender_id: 1, settings: { track_opens: true, track_clicks: false, ...settings } }] as any
      return { sequence_id: 's1' }
    }

    it("counts a click only where the sequence tracks them", () => {
      emailed('ana', {}, sequence())
      expect(who('clicked', 'not_in_last_days')).toEqual([])
      db.data.sequences = [{ id: 's1', sender_id: 1, settings: { track_opens: true, track_clicks: true } }] as any
      expect(who('clicked', 'not_in_last_days')).toEqual(['ana'])
    })

    it('finds a reply on the email or the enrollment', () => {
      emailed('ana', { replied_at: daysAgo(2) }, sequence())
      db.data.sequence_enrollments = [{ sequence_id: 's1', contact_email: 'ben@ben.test', replied_at: daysAgo(3) }] as any
      expect(who('replied', 'in_last_days')).toEqual(['ana', 'ben'])
    })

    it("says someone didn't reply only if a working inbox was watching for it", () => {
      emailed('ana', {}, sequence())
      expect(who('replied', 'not_in_last_days')).toEqual([])
      db.data.mailboxes = [{ sender_id: 1, status: 'auth_failed' }] as any
      expect(who('replied', 'not_in_last_days')).toEqual([])
      db.data.mailboxes = [{ sender_id: 1, status: 'ok' }] as any
      expect(who('replied', 'not_in_last_days')).toEqual(['ana'])
    })

    it("doesn't take an ordinary campaign as a chance to reply", () => {
      db.data.mailboxes = [{ sender_id: 1, status: 'ok' }] as any
      emailed('ana')
      expect(who('replied', 'not_in_last_days')).toEqual([])
    })
  })
})
