import { beforeEach, describe, expect, it } from 'vitest'
import { forgetWarmIndex, warmFor, warmIndex, warmTargets, warmWithoutRef } from './warmAccounts'

const now = new Date('2026-10-16T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()

const contact = (email: string, over: Record<string, unknown> = {}) => ({ email, first_name: '', last_name: '', job_title: '', company: '', status: 'subscribed', created_at: daysAgo(200), ...over })
const recipient = (email: string, over: Record<string, unknown> = {}) => ({ campaign_id: 1, contact_email: email, status: 'sent', opened_at: null, clicked_at: null, sent_at: daysAgo(10), opens: 0, clicks: 0, ...over })

function data(over: Record<string, unknown> = {}): any {
  return { contacts: [], campaign_recipients: [], form_submissions: [], survey_responses: [], companies: [], deals: [], proposals: [], sequence_enrollments: [], prospect_companies: [], ...over }
}

beforeEach(() => forgetWarmIndex())

describe('warm accounts', () => {
  it('counts replies, clicks, forms and surveys at a company, by work email domain', () => {
    const index = warmIndex(
      data({
        campaign_recipients: [recipient('jo@acme.com', { clicked_at: daysAgo(3) }), recipient('al@acme.com', { replied_at: daysAgo(2) })],
        form_submissions: [{ form_id: 'f', contact_email: 'sam@globex.io', submitted_at: daysAgo(5) }],
        survey_responses: [{ id: 's', survey_id: 'x', contact_email: 'kim@initech.co', status: 'completed', completed_at: daysAgo(1) }],
      }),
      now,
    )
    expect(index.byDomain.get('acme.com')).toMatchObject({ replies: 1, clicks: 1, lastAt: daysAgo(2) })
    expect(index.byDomain.get('globex.io')).toMatchObject({ forms: 1 })
    expect(index.byDomain.get('initech.co')).toMatchObject({ forms: 1 })
    expect(warmFor(index, { domain: 'www.ACME.com' })).toMatchObject({ kind: 'warm', label: 'Warm · 1 reply', source: 'workspace' })
    expect(warmFor(index, { domain: 'acme.com' })!.detail).toBe('At this company, in the last 90 days: 1 reply, 1 click.')
  })

  it('needs two people opening, and leaves out what is over 90 days old', () => {
    const one = warmIndex(data({ campaign_recipients: [recipient('jo@acme.com', { opened_at: daysAgo(4), opens: 1 })] }), now)
    expect(one.byDomain.has('acme.com')).toBe(false)
    forgetWarmIndex()
    const two = warmIndex(
      data({
        campaign_recipients: [
          recipient('jo@acme.com', { opened_at: daysAgo(4), opens: 1 }),
          recipient('al@acme.com', { opened_at: daysAgo(6), opens: 2 }),
          recipient('old@globex.io', { replied_at: daysAgo(120) }),
        ],
      }),
      now,
    )
    expect(two.byDomain.get('acme.com')).toMatchObject({ openers: 2 })
    expect(two.byDomain.has('globex.io')).toBe(false)
  })

  it('is cancelled by a complaint or unsubscribe there, and ignores free mail addresses unless linked to a company', () => {
    const index = warmIndex(
      data({
        contacts: [contact('pat@gmail.com', { company_id: 'c1' })],
        companies: [{ id: 'c1', name: 'Umbrella', domain: 'umbrella.com', linkedin_ref: null }],
        campaign_recipients: [
          recipient('jo@acme.com', { clicked_at: daysAgo(3) }),
          recipient('al@acme.com', { unsubscribed_at: daysAgo(1) }),
          recipient('pat@gmail.com', { clicked_at: daysAgo(2) }),
          recipient('lee@hotmail.com', { replied_at: daysAgo(2) }),
        ],
      }),
      now,
    )
    expect(index.byDomain.has('acme.com')).toBe(false)
    // Their own company, by the link on the contact; their gmail.com address says nothing about it.
    expect(index.byDomain.get('umbrella.com')).toMatchObject({ clicks: 1, companyId: 'c1' })
    expect(index.byDomain.has('gmail.com')).toBe(false)
    expect(index.byDomain.has('hotmail.com')).toBe(false)
    expect(warmFor(index, { domain: 'umbrella.com' })!.url).toBe('/marketing/companies/c1')
  })

  it('counts proposal views and acceptances through the deal’s company', () => {
    const index = warmIndex(
      data({
        companies: [{ id: 'c2', name: 'Hooli', domain: 'hooli.xyz', linkedin_ref: '777' }],
        deals: [{ id: 'd1', company_id: 'c2', contact_emails: [] }],
        proposals: [{ id: 'p1', deal_id: 'd1', views: 2, last_viewed_at: daysAgo(1), accepted_at: daysAgo(1) }],
      }),
      now,
    )
    expect(index.byDomain.get('hooli.xyz')).toMatchObject({ proposalViews: 1, accepted: 1, ref: '777' })
    expect(warmFor(index, { ref: '777' })).toMatchObject({ label: 'Warm · 1 proposal accepted' })
  })

  it('lists the companies to search inside: those with a LinkedIn id, newest first', () => {
    const index = warmIndex(
      data({
        prospect_companies: [
          { ref: '101', name: 'Acme', domain: 'acme.com' },
          { ref: 'globex-slug', name: 'Globex', domain: 'globex.io' },
        ],
        campaign_recipients: [recipient('jo@acme.com', { clicked_at: daysAgo(9) }), recipient('sam@globex.io', { clicked_at: daysAgo(1) }), recipient('kim@initech.co', { replied_at: daysAgo(2) })],
      }),
      now,
    )
    expect(warmTargets(index)).toEqual([{ ref: '101', name: 'Acme' }])
    // Globex's only id is a page name, and Initech has none: not searchable inside.
    expect(warmWithoutRef(index)).toBe(2)
  })

  it('keeps a person’s own engagement apart from their company’s', () => {
    const index = warmIndex(data({ campaign_recipients: [recipient('jo@acme.com', { clicked_at: daysAgo(3) }), recipient('al@acme.com', { opened_at: daysAgo(3), opens: 1 })] }), now)
    expect(index.byEmail.get('jo@acme.com')).toMatchObject({ clicks: 1 })
    // A single open by one person isn't warm.
    expect(index.byEmail.has('al@acme.com')).toBe(false)
  })
})
