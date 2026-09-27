import { beforeEach, describe, expect, it, vi } from 'vitest'
import { providerError } from './providers/types'

const managed = vi.hoisted(() => ({ on: false }))

vi.mock('./db', () => ({ db: { query: () => ({ get: () => null }) } }))
vi.mock('./env', () => ({ env: { sendingManaged: () => managed.on } }))
vi.mock('./emailSettings', () => ({
  getActiveProviderConfig: () => ({
    providerId: 'ses',
    creds: {},
    defaultSender: 'Acme <hello@acme.com>',
    missingFields: [],
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

const { sendMail } = await import('./nodemailer')

describe('send errors', () => {
  beforeEach(() => {
    managed.on = false
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
})
