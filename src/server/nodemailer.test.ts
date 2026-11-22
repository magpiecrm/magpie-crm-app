import { beforeEach, describe, expect, it, vi } from 'vitest'
import { providerError } from './providers/types'

const managed = vi.hoisted(() => ({ on: false }))
const config = vi.hoisted(() => ({ missingFields: [] as string[] }))
const demo = vi.hoisted(() => ({ on: false }))

vi.mock('./db', () => ({ db: { query: () => ({ get: () => null }) } }))
vi.mock('./env', () => ({ env: { sendingManaged: () => managed.on, demoMode: () => demo.on } }))
vi.mock('./emailSettings', () => ({
  getActiveProviderConfig: () => ({
    providerId: 'ses',
    creds: {},
    defaultSender: 'Acme <hello@acme.com>',
    missingFields: config.missingFields,
    credsUnreadable: false,
  }),
}))
vi.mock('./providers', () => ({
  getProvider: () => ({
    send: async () => {
      throw providerError('ses', 'jane@example.com', 'Email address is not verified.', 400)
    },
  }),
}))
vi.mock('./usage', () => ({ recordUsage: vi.fn() }))
vi.mock('./allowance', () => ({ requireAllowance: vi.fn() }))
vi.mock('./sendingDomains', () => ({ requireSendingDomain: vi.fn() }))
vi.mock('./mailboxes/send', () => ({ sendThroughMailbox: vi.fn(async () => ({ messageId: '<m1@acme.com>' })) }))

const { sendMail } = await import('./nodemailer')
const { sendThroughMailbox } = await import('./mailboxes/send')
const { requireSendingDomain } = await import('./sendingDomains')
const { requireAllowance } = await import('./allowance')
const { recordUsage } = await import('./usage')

describe('send errors', () => {
  beforeEach(() => {
    managed.on = false
    demo.on = false
  })

  it('name the provider when you run your own sending', async () => {
    await expect(sendMail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })).rejects.toThrow(
      'ses email sending failed for jane@example.com: Email address is not verified.',
    )
  })

  it("don't name the provider when the host runs sending", async () => {
    managed.on = true
    await expect(sendMail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })).rejects.toThrow(
      /^Email sending failed for jane@example\.com: Email address is not verified\.$/,
    )
  })

  it('never reach the provider in a demo copy, which says it sent', async () => {
    demo.on = true
    const sent = await sendMail({ to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>' })
    expect(sent.messageId).toMatch(/^demo-/)
  })
})

describe("through the sender's own mailbox", () => {
  beforeEach(() => {
    vi.mocked(sendThroughMailbox).mockClear()
    vi.mocked(requireSendingDomain).mockClear()
    vi.mocked(requireAllowance).mockClear()
    vi.mocked(recordUsage).mockClear()
    config.missingFields = []
    demo.on = false
  })

  it("goes through the mailbox, not the provider: counted, but no sending domain needed", async () => {
    managed.on = true
    const sent = await sendMail({
      from: 'Acme <hello@acme.com>',
      to: 'jane@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      campaignId: 7,
      via: { mailboxId: 'mb1' },
      unsubscribeMailto: 'mailto:hello@acme.com?subject=unsubscribe',
    })
    expect(sent).toEqual({ messageId: '<m1@acme.com>' })
    const [id, message, mailto] = vi.mocked(sendThroughMailbox).mock.calls[0]
    expect(id).toBe('mb1')
    expect(message).toMatchObject({ fromEmail: 'hello@acme.com', to: ['jane@example.com'], subject: 'Hi', text: 'Hi' })
    expect(mailto).toBe('mailto:hello@acme.com?subject=unsubscribe')
    expect(requireSendingDomain).not.toHaveBeenCalled()
    expect(requireAllowance).toHaveBeenCalledWith('emailsSent', 1)
    expect(recordUsage).toHaveBeenCalledWith({ emailsSent: 1 })
  })

  it("isn't swallowed when the workspace's own provider isn't set up", async () => {
    config.missingFields = ['apiKey']
    await sendMail({ from: 'hello@acme.com', to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>', via: { mailboxId: 'mb1' } })
    expect(sendThroughMailbox).toHaveBeenCalledTimes(1)
  })

  it("doesn't go through it in a demo copy either", async () => {
    demo.on = true
    const sent = await sendMail({ from: 'hello@acme.com', to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>', via: { mailboxId: 'mb1' } })
    expect(sent.messageId).toMatch(/^demo-/)
    expect(sendThroughMailbox).not.toHaveBeenCalled()
  })

  it('still refuses a From that is no sender of the workspace', async () => {
    await expect(sendMail({ from: 'someone@else.com', to: 'jane@example.com', subject: 'Hi', html: '<p>Hi</p>', via: { mailboxId: 'mb1' } })).rejects.toThrow(/Unauthorized sender/)
    expect(sendThroughMailbox).not.toHaveBeenCalled()
  })
})
