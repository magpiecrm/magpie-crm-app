import { describe, expect, it } from 'vitest'
import { sortCampaigns } from './sort'

const campaign = (id: number, name: string, when: { sentAt?: string; createdAt: string }, stats: Record<string, number> = {}) => ({
  id,
  name,
  sentAt: when.sentAt ?? null,
  createdAt: when.createdAt,
  statistics: { globalStats: stats },
})

const all = [
  campaign(1, 'Spring', { createdAt: '2026-03-01T09:00:00Z', sentAt: '2026-03-02T09:00:00Z' }, { sent: 100, delivered: 100, uniqueOpens: 40, uniqueClicks: 5, unsubscribed: 1 }),
  campaign(2, 'autumn', { createdAt: '2026-02-01T09:00:00Z', sentAt: '2026-09-01T09:00:00Z' }, { sent: 1000, delivered: 900, uniqueOpens: 180, uniqueClicks: 90, hardBounces: 100 }),
  campaign(3, 'Draft idea', { createdAt: '2026-06-01T09:00:00Z' }),
  campaign(4, 'Summer', { createdAt: '2026-05-01T09:00:00Z', sentAt: '2026-06-15T09:00:00Z' }, { sent: 10, delivered: 10, uniqueOpens: 6, uniqueClicks: 0, unsubscribed: 2 }),
]
const names = (sort: Parameters<typeof sortCampaigns>[1]) => sortCampaigns(all, sort).map((c) => c.name)

describe('sortCampaigns', () => {
  it('puts the most recent first by when each was sent, or made if it hasn’t been', () => {
    expect(names('newest')).toEqual(['autumn', 'Summer', 'Draft idea', 'Spring'])
    expect(names('oldest')).toEqual(['Spring', 'Draft idea', 'Summer', 'autumn'])
    // A new list each time: the one handed in keeps its order.
    expect(all.map((c) => c.id)).toEqual([1, 2, 3, 4])
  })

  it('orders by a rate, highest first, with campaigns that have sent nothing last', () => {
    expect(names('openRate')).toEqual(['Summer', 'Spring', 'autumn', 'Draft idea'])
    expect(names('clickRate')).toEqual(['autumn', 'Spring', 'Summer', 'Draft idea'])
    expect(names('unsubRate')).toEqual(['Summer', 'Spring', 'autumn', 'Draft idea'])
    expect(names('bounceRate')).toEqual(['autumn', 'Summer', 'Spring', 'Draft idea'])
    expect(names('recipients')).toEqual(['autumn', 'Spring', 'Summer', 'Draft idea'])
  })

  it('orders by name whatever the capitals', () => {
    expect(names('name')).toEqual(['autumn', 'Draft idea', 'Spring', 'Summer'])
  })
})
