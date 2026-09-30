import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Companies, pipelines, deals and notes on a real (scratch) database.

const scratchDir = mkdtempSync(join(tmpdir(), 'sales-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { db } = await import('../db')
const { sales } = await import('.')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const contact = (email: string, company = '', first = '', last = '') => ({
  email, first_name: first, last_name: last, job_title: '', company, status: 'subscribed', created_at: new Date().toISOString(),
})

beforeEach(() => {
  db.mutate((d) => {
    d.contacts = []
    d.companies = undefined
    d.pipelines = undefined
    d.deals = undefined
    d.activities = undefined
    d.prospect_companies = []
    if (!d.users.some((u) => u.email === 'me@acme.test')) d.users.push({ email: 'me@acme.test', passwordHash: 'x' })
  })
})

describe('companies', () => {
  it('groups contacts by work email domain, and by typed name for free mail addresses', () => {
    db.mutate((d) => {
      d.contacts.push(
        contact('ava@larkspur.example', 'Larkspur'),
        contact('ravi@larkspur.example', 'larkspur ltd'),
        contact('tom@larkspur.example', 'Larkspur'),
        contact('sam@gmail.com', 'Northwind'),
        contact('jo@hotmail.com'),
      )
      d.prospect_companies = [{ ref: '42', name: 'Larkspur Labs', domain: 'larkspur.example', domain_source: 'socialfetch', headcount: 30, updated_at: '' }]
    })
    const list = sales.listCompanies()
    expect(list.map((c) => [c.name, c.domain, c.contacts]).sort()).toEqual([
      ['Larkspur', 'larkspur.example', 3],
      ['Northwind', null, 1],
    ])
    expect(list.find((c) => c.name === 'Larkspur')).toMatchObject({ headcount: 30, linkedin_ref: '42' })
    expect(db.data.contacts.find((c) => c.email === 'jo@hotmail.com')?.company_id).toBeNull()

    // A later contact at the same domain joins it; nothing is made twice.
    db.mutate((d) => d.contacts.push(contact('chloe@larkspur.example')))
    expect(sales.listCompanies().find((c) => c.name === 'Larkspur')?.contacts).toBe(4)
    expect(sales.listCompanies()).toHaveLength(2)
  })

  it('names a company from its domain when no contact typed one', () => {
    db.mutate((d) => d.contacts.push(contact('x@cobalt-freight.example')))
    expect(sales.listCompanies()[0].name).toBe('Cobalt Freight')
  })

  it('takes in contacts at its domain when made by hand, and lets them go when deleted', () => {
    sales.listCompanies()
    db.mutate((d) => d.contacts.push({ ...contact('a@brightwell.example'), company_id: null }))
    const company = sales.createCompany({ name: 'Brightwell', domain: 'https://www.Brightwell.example/about' })
    expect(company.domain).toBe('brightwell.example')
    expect(sales.getCompany(company.id).contacts.map((c) => c.email)).toEqual(['a@brightwell.example'])
    expect(() => sales.createCompany({ name: 'Other', domain: 'brightwell.example' })).toThrow(/already exists/)
    expect(() => sales.updateCompany(company.id, { owner: 'stranger@x.test' })).toThrow(/isn't a user/)

    const deal = sales.createDeal({ name: 'Pilot', companyId: company.id }, 'me@acme.test')
    sales.deleteCompany(company.id)
    expect(db.data.contacts[0].company_id).toBeNull()
    expect(sales.getDeal(deal.id).deal.company_id).toBeNull()
    // Deleted on purpose: grouping doesn't make it again.
    expect(sales.listCompanies()).toHaveLength(0)
  })
})

describe('pipelines', () => {
  it('starts with a Sales pipeline, and needs one won and one lost stage', () => {
    const [p] = sales.listPipelines()
    expect(p.name).toBe('Sales')
    expect(p.stages.map((s) => s.kind)).toEqual(['open', 'open', 'open', 'open', 'open', 'won', 'lost'])
    const open = p.stages.filter((s) => s.kind === 'open')
    expect(() => sales.updatePipeline(p.id, { name: 'Sales', stages: open })).toThrow(/Won stage/)
    expect(() => sales.createPipeline({ name: '', stages: [] })).toThrow(/Name/)
    const renewals = sales.createPipeline({ name: 'Renewals', stages: [] })
    expect(sales.listPipelines().map((x) => x.name)).toEqual(['Sales', 'Renewals'])
    sales.reorderPipelines([renewals.id, p.id])
    expect(sales.listPipelines()[0].name).toBe('Renewals')
  })

  it("won't drop a stage that has deals, and closes deals when a stage becomes won", () => {
    const [p] = sales.listPipelines()
    const proposal = p.stages[3]
    const deal = sales.createDeal({ name: 'Big one', stageId: proposal.id }, null)
    const without = p.stages.filter((s) => s.id !== proposal.id)
    expect(() => sales.updatePipeline(p.id, { name: 'Sales', stages: without })).toThrow(/"Proposal sent" still has 1 deal/)
    expect(() => sales.deletePipeline(p.id)).toThrow(/at least one pipeline/)

    const stages = p.stages.map((s) => (s.kind === 'won' ? { ...s, kind: 'open' as const } : s.id === proposal.id ? { ...s, kind: 'won' as const } : s))
    sales.updatePipeline(p.id, { name: 'Sales', stages })
    expect(sales.getDeal(deal.id).deal).toMatchObject({ status: 'won' })
    expect(sales.getDeal(deal.id).deal.closed_at).toBeTruthy()
  })
})

describe('deals', () => {
  it('are made in the first open stage, owned by whoever made them, with their people', () => {
    db.mutate((d) => d.contacts.push(contact('ava@larkspur.example', 'Larkspur', 'Ava', 'Thornton')))
    const company = sales.listCompanies()[0]
    const deal = sales.createDeal({ name: 'Larkspur pilot', value: 125000, companyId: company.id, contactEmails: ['AVA@larkspur.example'] }, 'me@acme.test')
    expect(deal).toMatchObject({
      stage_name: 'New lead', pipeline_name: 'Sales', status: 'open', value: 125000, owner: 'me@acme.test',
      company_name: 'Larkspur', contacts: [{ email: 'ava@larkspur.example', name: 'Ava Thornton' }],
    })
    expect(sales.listCompanies()[0]).toMatchObject({ open_deals: 1, open_value: 125000 })
    expect(() => sales.createDeal({ name: 'X', contactEmails: ['nobody@x.test'] }, null)).toThrow(/isn't a contact/)
    expect(() => sales.createDeal({ name: 'X', owner: 'stranger@x.test' }, null)).toThrow(/isn't a user/)
  })

  it('move between stages with a history, close on won or lost, and keep their order in a column', () => {
    const [p] = sales.listPipelines()
    const [first, second] = p.stages
    const won = p.stages.find((s) => s.kind === 'won')!
    const lost = p.stages.find((s) => s.kind === 'lost')!
    const a = sales.createDeal({ name: 'A' }, 'me@acme.test')
    const b = sales.createDeal({ name: 'B' }, 'me@acme.test')
    // New deals go to the top of the column.
    expect(sales.listDeals({ pipelineId: p.id }).map((d) => d.name)).toEqual(['B', 'A'])
    sales.moveDeal(a.id, { stageId: first.id, index: 0 }, null)
    expect(sales.listDeals({ pipelineId: p.id }).map((d) => d.name)).toEqual(['A', 'B'])

    sales.moveDeal(a.id, { stageId: second.id }, 'me@acme.test')
    sales.moveDeal(a.id, { stageId: won.id }, 'me@acme.test')
    expect(sales.getDeal(a.id).deal).toMatchObject({ status: 'won', stage_name: 'Won' })
    sales.moveDeal(b.id, { stageId: lost.id, lostReason: 'Went with a competitor' }, null)
    expect(sales.getDeal(b.id).deal).toMatchObject({ status: 'lost', lost_reason: 'Went with a competitor' })
    sales.moveDeal(b.id, { stageId: first.id }, null)
    expect(sales.getDeal(b.id).deal).toMatchObject({ status: 'open', lost_reason: null, closed_at: null })

    expect(sales.getDeal(a.id).activities.map((x) => x.body)).toEqual(['Moved to Won', 'Moved to Contacted', 'Created in New lead'])
    expect(sales.listDeals({ status: 'won' }).map((d) => d.name)).toEqual(['A'])

    const renewals = sales.createPipeline({ name: 'Renewals', stages: [] })
    sales.moveDeal(b.id, { pipelineId: renewals.id, stageId: renewals.stages[1].id }, null)
    expect(sales.getDeal(b.id).deal).toMatchObject({ pipeline_name: 'Renewals', stage_name: 'Contacted' })
    expect(sales.getDeal(b.id).activities[0].body).toBe('Moved to Contacted (Renewals)')
  })

  it('take notes, which can be deleted (the stage history can’t), and go with the deal', () => {
    const deal = sales.createDeal({ name: 'A' }, null)
    const note = sales.addNote({ dealId: deal.id }, 'Call went well', 'me@acme.test')
    expect(sales.getDeal(deal.id).activities[0]).toMatchObject({ kind: 'note', body: 'Call went well', created_by: 'me@acme.test' })
    const created = sales.getDeal(deal.id).activities.find((x) => x.kind === 'created')!
    expect(() => sales.deleteNote(created.id)).toThrow(/Only notes/)
    sales.deleteNote(note.id)
    expect(() => sales.addNote({}, 'x', null)).toThrow(/what the note is about/)
    sales.deleteDeal(deal.id)
    expect(db.data.activities).toEqual([])
  })

  it('search by name, company or person', () => {
    db.mutate((d) => d.contacts.push(contact('ava@larkspur.example', 'Larkspur', 'Ava', 'Thornton')))
    const company = sales.listCompanies()[0]
    sales.createDeal({ name: 'Pilot', companyId: company.id }, null)
    sales.createDeal({ name: 'Renewal', contactEmails: ['ava@larkspur.example'] }, null)
    sales.createDeal({ name: 'Other' }, null)
    expect(sales.listDeals({ q: 'larkspur' }).map((d) => d.name).sort()).toEqual(['Pilot', 'Renewal'])
    expect(sales.listDeals({ q: 'thornton' }).map((d) => d.name)).toEqual(['Renewal'])
  })
})

describe('tasks', () => {
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

  it('lists open tasks soonest due first, then recently done ones, each with what it is about', () => {
    db.mutate((d) => d.contacts.push(contact('ava@larkspur.example', 'Larkspur', 'Ava', 'Stone')))
    const deal = sales.createDeal({ name: 'Larkspur pilot' }, 'me@acme.test')
    const later = sales.addTask({ body: 'Send the contract', dueAt: inHours(48), dealId: deal.id }, 'me@acme.test')
    const whenever = sales.addTask({ body: 'Tidy the list', dueAt: null }, null)
    const soon = sales.addTask({ body: 'Follow up with Ava Stone', dueAt: inHours(1), contactEmail: 'AVA@larkspur.example' }, 'me@acme.test')
    const done = sales.addTask({ body: 'Book the demo', dueAt: inHours(-5) }, null)
    sales.updateTask(done.id, { done: true })

    expect(sales.listTasks().map((t) => t.body)).toEqual(['Follow up with Ava Stone', 'Send the contract', 'Tidy the list', 'Book the demo'])
    expect(sales.listTasks({ dealId: deal.id }).map((t) => t.id)).toEqual([later.id])
    expect(sales.listTasks({ contactEmail: 'ava@larkspur.example' })[0]).toMatchObject({
      id: soon.id,
      contact_name: 'Ava Stone',
      link: '/marketing/contacts?contact=ava%40larkspur.example',
    })
    expect(later).toMatchObject({ deal_name: 'Larkspur pilot', link: `/sales/deals/${deal.id}` })
    expect(whenever.link).toBe('/sales/tasks')
    // A deal's tasks are in its timeline too.
    expect(sales.getDeal(deal.id).activities.some((a) => a.id === later.id)).toBe(true)
  })

  it('refuses an empty task, a bad date, or a record that does not exist', () => {
    expect(() => sales.addTask({ body: '  ', dueAt: null }, null)).toThrow(/needs doing/)
    expect(() => sales.addTask({ body: 'x', dueAt: 'soon' }, null)).toThrow(/isn't a date/)
    expect(() => sales.addTask({ body: 'x', dueAt: null, dealId: 'nope' }, null)).toThrow(/Deal not found/)
    expect(() => sales.addTask({ body: 'x', dueAt: null, contactEmail: 'who@nowhere.example' }, null)).toThrow(/Contact not found/)
  })

  it('reminds once when a task falls due, and again after it is moved', () => {
    const task = sales.addTask({ body: 'Call Sam', dueAt: inHours(-0.1) }, null)
    sales.addTask({ body: 'Not yet', dueAt: inHours(3) }, null)
    const finished = sales.addTask({ body: 'Already done', dueAt: inHours(-1) }, null)
    sales.updateTask(finished.id, { done: true })

    expect(sales.takeDueReminders().map((t) => t.body)).toEqual(['Call Sam'])
    expect(sales.takeDueReminders()).toEqual([])

    sales.updateTask(task.id, { dueAt: inHours(-0.05) })
    expect(sales.takeDueReminders().map((t) => t.id)).toEqual([task.id])
  })

  it('ticks off, unticks and deletes a task', () => {
    const task = sales.addTask({ body: 'Chase the invoice', dueAt: null }, null)
    expect(sales.updateTask(task.id, { done: true }).done_at).toBeTruthy()
    expect(sales.updateTask(task.id, { done: false }).done_at).toBeNull()
    sales.deleteTask(task.id)
    expect(sales.listTasks()).toEqual([])
    expect(() => sales.deleteTask(task.id)).toThrow(/Task not found/)
  })
})

describe('deleting a contact', () => {
  it('deletes the notes and tasks only about them, and unlinks them from a deal\'s', () => {
    db.mutate((d) => d.contacts.push(contact('ava@larkspur.example', 'Larkspur', 'Ava', 'Stone')))
    const deal = sales.createDeal({ name: 'Pilot' }, null)
    sales.addTask({ body: 'Follow up with Ava Stone', dueAt: null, contactEmail: 'ava@larkspur.example' }, null)
    const onDeal = sales.addTask({ body: 'Send Ava the terms', dueAt: null, dealId: deal.id, contactEmail: 'ava@larkspur.example' }, null)
    db.prepare('DELETE FROM contacts WHERE email = ?').run('ava@larkspur.example')
    expect(sales.listTasks().map((t) => [t.id, t.contact_email])).toEqual([[onDeal.id, null]])
  })
})
