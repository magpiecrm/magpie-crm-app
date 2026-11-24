import { describe, expect, it } from 'vitest'
import { buildFeed, formatAgo, formatDay, formatWhen, matchesFilter } from './record'
import type { ContactActivity } from '../../server/contactActivity'

const ev = (type: ContactActivity['type'], at: string, ref: string, name = 'News'): ContactActivity => ({ type, at, ref, name, label: `${type} ${name}` })

describe('buildFeed', () => {
  it('shows an email’s send, open, click and reply as one item, dated by the send', () => {
    const feed = buildFeed(
      [
        ev('sequence_replied', '2026-11-03T12:00:00Z', 'email:7', 'Q4, email 1'),
        ev('sequence_clicked', '2026-11-02T10:00:00Z', 'email:7', 'Q4, email 1'),
        ev('sequence_opened', '2026-11-01T10:05:00Z', 'email:7', 'Q4, email 1'),
        ev('sequence_sent', '2026-11-01T09:00:00Z', 'email:7', 'Q4, email 1'),
      ],
      [],
    )
    expect(feed).toEqual([
      expect.objectContaining({ kind: 'sequence', title: 'Q4, email 1', at: '2026-11-01T09:00:00Z', opened: '2026-11-01T10:05:00Z', clicked: '2026-11-02T10:00:00Z', replied: '2026-11-03T12:00:00Z' }),
    ])
  })

  it('puts notes among the events, newest first', () => {
    const feed = buildFeed(
      [ev('campaign_sent', '2026-10-01T09:00:00Z', 'email:1'), ev('form_submitted', '2026-11-05T09:00:00Z', 'form:f:1', 'Sign-up')],
      [{ id: 'n1', body: 'Called', created_by: null, created_at: '2026-10-20T09:00:00Z' }],
    )
    expect(feed.map((i) => i.kind)).toEqual(['form', 'note', 'campaign'])
    expect(feed.filter((i) => matchesFilter(i, 'emails')).map((i) => i.key)).toEqual(['email:1'])
    expect(feed.filter((i) => matchesFilter(i, 'forms')).map((i) => i.key)).toEqual(['form:f:1'])
  })

  it('dates an email with no recorded send by its first event', () => {
    const feed = buildFeed([ev('campaign_clicked', '2026-10-03T09:00:00Z', 'email:2'), ev('campaign_opened', '2026-10-02T09:00:00Z', 'email:2')], [])
    expect(feed[0].at).toBe('2026-10-02T09:00:00Z')
  })
})

it('gives each reply its own item and puts survey answers on their survey', () => {
  const feed = buildFeed(
    [ev('survey_started', '2026-10-01T09:00:00Z', 'survey:r1', 'NPS'), ev('survey_completed', '2026-10-01T09:02:00Z', 'survey:r1', 'NPS')],
    [],
    [{ id: 'm1', enrollment_id: 'e1', sequence_id: 's1', sequence_name: 'Webinar', subject: 'Re: Hi', at: '2026-10-05T09:00:00Z', excerpt: 'Thanks', answered: false }],
    [{ id: 'r1', answers: [{ question: 'Score?', answer: '9' }] }],
  )
  expect(feed.map((i) => i.kind)).toEqual(['reply', 'survey'])
  expect(feed[1].answers).toEqual([{ question: 'Score?', answer: '9' }])
  expect(feed.filter((i) => matchesFilter(i, 'emails')).map((i) => i.kind)).toEqual(['reply'])
})

describe('dates', () => {
  const now = new Date('2026-11-23T10:30:00Z')
  it('leaves the year off this year’s dates and never shows seconds', () => {
    expect(formatDay('2026-09-16T11:35:12Z', now)).toBe('16 Sep')
    expect(formatDay('2025-09-16T11:35:12Z', now)).toBe('16 Sep 2025')
    expect(formatWhen('2026-09-16T11:35:12Z', now)).toMatch(/^16 Sep, \d\d:35$/)
  })
  it('names the weekday of a time in the coming week', () => {
    expect(formatWhen('2026-11-25T09:00:00Z', now)).toBe('Wed 25 Nov, 09:00')
    expect(formatWhen('2026-12-25T09:00:00Z', now)).toBe('25 Dec, 09:00')
  })
  it('says how long ago, then the day', () => {
    expect(formatAgo('2026-11-23T10:10:00Z', now)).toBe('20 min ago')
    expect(formatAgo('2026-11-22T15:00:00Z', now)).toBe('Yesterday')
    expect(formatAgo('2026-11-19T15:00:00Z', now)).toBe('4 days ago')
    expect(formatAgo('2026-10-19T15:00:00Z', now)).toBe('19 Oct')
  })
})
