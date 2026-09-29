import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Open tracking is a setting on each campaign, kept through edits and copies,
// on real (scratch) storage.

const scratchDir = mkdtempSync(join(tmpdir(), 'campaign-open-tracking-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const emailService = await import('./emailService')

afterAll(() => rmSync(scratchDir, { recursive: true, force: true }))

describe('open tracking on a campaign', () => {
  it('is on unless turned off, can be changed on a draft, and is kept by a copy', async () => {
    const on = await emailService.createCampaign({ name: 'Newsletter', subject: 'Hi', htmlContent: '<p>Hi</p>' })
    expect((await emailService.getCampaign(on.id)).trackOpens).toBe(true)

    const off = await emailService.createCampaign({ name: 'Outreach', subject: 'Hi', htmlContent: '<p>Hi</p>', trackOpens: false })
    expect((await emailService.getCampaign(off.id)).trackOpens).toBe(false)

    await emailService.updateCampaign(on.id, { trackOpens: false })
    expect((await emailService.getCampaign(on.id)).trackOpens).toBe(false)
    // An edit that doesn't mention it leaves it as it was.
    await emailService.updateCampaign(on.id, { subject: 'Hello' })
    expect((await emailService.getCampaign(on.id)).trackOpens).toBe(false)

    const copy = await emailService.duplicateCampaign(off.id)
    expect((await emailService.getCampaign(copy.id)).trackOpens).toBe(false)

    const listed = (await emailService.getCampaigns()).campaigns
    expect(listed.find((c: { id: number }) => c.id === on.id)?.trackOpens).toBe(false)
  })
})
