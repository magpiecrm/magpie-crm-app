import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Proposals on a real (scratch) database, and the page their link shows.

const scratchDir = mkdtempSync(join(tmpdir(), 'proposals-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { db } = await import('../db')
const { sales } = await import('.')
const { RETURN_VISIT_MS, recordView } = await import('./proposals')
const { personalise, proposalEmail, proposalPage } = await import('../proposalPage')
const { proposalHtml } = await import('../../features/sales/proposalLayout')
const { extractDesign } = await import('../../features/email-builder/utils/design')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

beforeEach(() => {
  db.mutate((d) => {
    d.contacts = []
    d.companies = undefined
    d.pipelines = undefined
    d.deals = undefined
    d.activities = undefined
    d.proposals = undefined
  })
})

const newDeal = () => sales.createDeal({ name: 'Larkspur pilot' }, 'me@acme.test')
const bodies = (dealId: string) => sales.getDeal(dealId).activities.map((a) => a.body)

describe('proposals', () => {
  it('moves the deal on to "Proposal sent" when first sent, but never back', () => {
    const deal = newDeal()
    const p = sales.createProposal({ dealId: deal.id, title: 'Pilot proposal', html: '<p>Hi</p>' }, 'me@acme.test')
    expect(p.token.length).toBeGreaterThanOrEqual(32)
    expect(p.sent_at).toBeNull()

    const { movedTo } = sales.markProposalSent(p.id, 'me@acme.test', 'Link shared')
    expect(movedTo).toBe('Proposal sent')
    expect(sales.getDeal(deal.id).deal.stage_name).toBe('Proposal sent')
    expect(sales.getProposal(p.id).sent_at).toBeTruthy()
    expect(bodies(deal.id)).toEqual(expect.arrayContaining(['Link shared: Pilot proposal', 'Moved to Proposal sent']))

    // Already past it: stays in Negotiation.
    const negotiation = sales.listPipelines()[0].stages.find((s) => s.name === 'Negotiation')!
    sales.moveDeal(deal.id, { stageId: negotiation.id }, null)
    expect(sales.markProposalSent(p.id, null, 'Emailed to ava@larkspur.example').movedTo).toBeNull()
    expect(sales.getDeal(deal.id).deal.stage_name).toBe('Negotiation')
  })

  it("counts people's opens, not the team's previews or link scanners, and says when they're back", () => {
    const deal = newDeal()
    const p = sales.createProposal({ dealId: deal.id, title: 'Pilot proposal', html: '' }, null)
    expect(sales.recordProposalView(p.token, { automated: false, team: true })).toEqual({ counted: false })
    expect(sales.recordProposalView(p.token, { automated: true, team: false })).toEqual({ counted: false })
    expect(sales.recordProposalView('nope', { automated: false, team: false })).toEqual({ counted: false })

    const t0 = new Date('2026-10-01T10:00:00Z')
    const first = db.mutate((d) => recordView(d, p.token, { automated: false, team: false }, t0))
    expect(first).toMatchObject({ counted: true, first: true, returned: false, dealName: 'Larkspur pilot' })
    const soon = db.mutate((d) => recordView(d, p.token, { automated: false, team: false }, new Date(t0.getTime() + 5 * 60_000)))
    expect(soon).toMatchObject({ first: false, returned: false })
    const later = db.mutate((d) => recordView(d, p.token, { automated: false, team: false }, new Date(t0.getTime() + 5 * 60_000 + RETURN_VISIT_MS)))
    expect(later).toMatchObject({ first: false, returned: true })

    expect(sales.getProposal(p.id)).toMatchObject({ views: 3, bot_views: 1, first_viewed_at: t0.toISOString() })
    expect(bodies(deal.id).filter((b) => b.startsWith('Opened'))).toEqual(['Opened: Pilot proposal'])
  })

  it('is accepted once, in the name they typed', () => {
    const deal = newDeal()
    const p = sales.createProposal({ dealId: deal.id, title: 'Pilot proposal', html: '' }, null)
    expect(() => sales.acceptProposal(p.token, '   ')).toThrow(/Type your name/)
    expect(sales.acceptProposal(p.token, ' Ava Stone ')).toMatchObject({ already: false, proposal: { accepted_by: 'Ava Stone' } })
    expect(sales.acceptProposal(p.token, 'Someone else')).toMatchObject({ already: true, proposal: { accepted_by: 'Ava Stone' } })
    expect(sales.acceptProposal('nope', 'x')).toBeNull()
    expect(bodies(deal.id)).toContain('Accepted by Ava Stone: Pilot proposal')
  })

  it("lists a deal's proposals without their HTML or token, and goes when the deal does", () => {
    const deal = newDeal()
    const p = sales.createProposal({ dealId: deal.id, title: 'Pilot proposal', html: '<p>secret design</p>' }, null)
    const [listed] = sales.listProposals(deal.id, 'https://acme.example')
    expect(listed.url).toBe(`https://acme.example/p/${p.token}`)
    expect(listed).not.toHaveProperty('html')
    expect(listed).not.toHaveProperty('token')
    sales.deleteDeal(deal.id)
    expect(sales.proposalByToken(p.token)).toBeNull()
  })
})

describe('the proposal page', () => {
  const proposal = (html: string) => ({
    ...sales.createProposal({ dealId: newDeal().id, title: 'Save $& 50% <now>', html }, null),
  })

  it("fills in the reader's details, escaped, and drops unsubscribe links and the design data", () => {
    const html = '<p>Hi {{ contact.FIRSTNAME }} at {{contact.COMPANY}}</p><a href="{{ unsubscribe }}">x</a><!-- BLOCKS_DATA: {"blocks":[]} -->'
    expect(personalise(html, { first_name: '<Ava>', company: 'Larkspur' })).toBe('<p>Hi &lt;Ava&gt; at Larkspur</p><a href="#">x</a>')
  })

  it('adds a title, the accept form and, for the team, a preview banner', () => {
    const p = proposal('<!DOCTYPE html><html><head><title>Email</title></head><body style="margin:0"><p>Body</p></body></html>')
    const page = proposalPage(p, { reader: null, preview: true, color: 'red;background:url(x)' })
    expect(page).toContain('<title>Save $&amp; 50% &lt;now&gt;</title>')
    expect(page).not.toContain('<title>Email</title>')
    expect(page).toMatch(/<body style="margin:0"><p class="mp-preview">/)
    expect(page).toMatch(/<p>Body<\/p><section class="mp-accept">[\s\S]*<form method="post"[\s\S]*<\/section><\/body>/)
    // Not a plain colour, so not used.
    expect(page).toContain('background:#111827')
    expect(proposalPage(p, { reader: null, preview: false })).not.toContain('class="mp-preview"')
  })

  it('says who accepted it instead of the form', () => {
    const p = proposal('<p>Body</p>')
    sales.acceptProposal(p.token, 'Ava Stone')
    const page = proposalPage(sales.getProposal(p.id), { reader: null, preview: false })
    expect(page).toContain('Accepted by Ava Stone')
    expect(page).not.toContain('<form')
  })

  it('emails a button to the link under the message, escaped', () => {
    const email = proposalEmail('Hi <Ava>,\n\nHere it is.', 'https://acme.example/p/abc', 'Pilot', '#ff0000')
    expect(email).toContain('<p style="margin:0 0 16px">Hi &lt;Ava&gt;,</p><p style="margin:0 0 16px">Here it is.</p>')
    expect(email).toContain('href="https://acme.example/p/abc" style="display:inline-block;background:#ff0000')
  })
})

describe('the proposal layout', () => {
  it('starts from the deal, with its price, and opens in the builder', () => {
    const html = proposalHtml({ title: 'Pilot proposal', client: 'Larkspur', firstName: 'Ava', price: '£4,500', brand: { name: 'Acme' } })
    const design = extractDesign(html)!
    expect(design.blocks.find((b) => b.type === 'receipt')?.summaryRows?.[0]).toMatchObject({ label: 'Total', value: '£4,500' })
    expect(html).toContain('Prepared for Larkspur')
    expect(html).toContain('Hi Ava,')
    expect(html).not.toContain('unsubscribe')
  })
})
