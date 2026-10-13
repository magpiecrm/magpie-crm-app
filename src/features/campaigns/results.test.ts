import { describe, expect, it } from 'vitest'
import { campaignSummary, summariseCampaigns } from './results'

const sent = (stats: Record<string, number>, trackOpens?: boolean) => ({ ...(trackOpens === undefined ? {} : { trackOpens }), statistics: { globalStats: stats } })

describe('campaignSummary', () => {
  it('gives rates as percentages of what was delivered, and bounces of what was sent', () => {
    expect(campaignSummary(sent({ sent: 200, delivered: 180, uniqueViews: 45, uniqueClicks: 9, unsubscriptions: 2, complaints: 1, softBounces: 5, hardBounces: 15 }))).toMatchObject({
      sent: 200,
      delivered: 180,
      opened: 45,
      bounces: 20,
      tracksOpens: true,
      openRate: 25,
      clickRate: 5,
      bounceRate: 10,
    })
  })

  it('works delivered out from the bounces where it is missing, and adds up per-send rows', () => {
    expect(campaignSummary(sent({ sent: 100, hardBounces: 20, uniqueViews: 8 }))).toMatchObject({ delivered: 80, openRate: 10 })
    expect(campaignSummary({ statistics: { campaignStats: [{ sent: 60, delivered: 60, viewed: 6 }, { sent: 40, delivered: 40, viewed: 14 }] } })).toMatchObject({ sent: 100, opened: 20, openRate: 20 })
    expect(campaignSummary({})).toMatchObject({ sent: 0, openRate: 0, clickRate: 0 })
  })

  it('has no open rate for a campaign sent without open tracking', () => {
    expect(campaignSummary(sent({ sent: 100, delivered: 100, uniqueClicks: 10 }, false))).toMatchObject({ tracksOpens: false, opened: 0, openRate: null, clickRate: 10 })
  })
})

describe('summariseCampaigns', () => {
  it('divides opens by the emails delivered in campaigns that track opens, and everything else by them all', () => {
    const totals = summariseCampaigns([
      sent({ sent: 200, delivered: 200, uniqueViews: 50, uniqueClicks: 10 }),
      sent({ sent: 300, delivered: 300, uniqueClicks: 15 }, false),
      sent({}, false), // a draft: not a campaign that went out untracked
    ])
    expect(totals).toMatchObject({ sent: 500, delivered: 500, trackedDelivered: 200, opened: 50, untracked: 1, openRate: 25, clickRate: 5 })
    // Counting the untracked campaign's emails as unopened would have said 10%.
  })

  it('has nothing to divide by when no campaign tracked opens', () => {
    expect(summariseCampaigns([sent({ sent: 300, delivered: 300 }, false)])).toMatchObject({ trackedDelivered: 0, openRate: 0 })
  })
})
