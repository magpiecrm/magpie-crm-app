import { afterEach, describe, expect, it, vi } from 'vitest'

const transports: any[] = []
const sent: any[] = []
let refuse: any = null
vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: any) => {
      transports.push(options)
      return {
        sendMail: async (mail: any) => {
          if (refuse) throw refuse
          sent.push(mail)
          return { messageId: '<m1@acme.test>' }
        },
        close: () => {},
      }
    },
  },
}))

const { smtpProvider, resetSmtpTransport } = await import('./smtp')
const { isUnknownRecipient } = await import('./types')

const creds = { host: 'mta.host.test', port: '587', user: 'acme', pass: 'pw' }
const msg = { from: 'Jo <jo@acme.com>', fromEmail: 'jo@acme.com', to: ['sam@example.com'], subject: 'Hello', html: '<p>Hi Sam,</p><p>See <a href="https://acme.com">our site</a>.</p>' }

afterEach(() => {
  resetSmtpTransport()
  transports.length = 0
  sent.length = 0
  refuse = null
  delete process.env.PUBLIC_URL
  delete process.env.SENDING_MANAGED
})

describe('SMTP sending', () => {
  it('sends a plain-text version with the HTML, and introduces itself by the copy’s own hostname', async () => {
    process.env.PUBLIC_URL = 'https://acme.magpiecrm.com'
    await smtpProvider.send(msg, creds)
    expect(sent[0].text).toBe('Hi Sam,\n\nSee our site (https://acme.com).')
    expect(sent[0].html).toBe(msg.html)
    expect(transports[0].name).toBe('acme.magpiecrm.com')
  })

  it("leaves the name to nodemailer without a PUBLIC_URL, and pools with TLS required on the host's server", async () => {
    process.env.SENDING_MANAGED = 'on'
    await smtpProvider.send(msg, creds)
    expect(transports[0].name).toBeUndefined()
    expect(transports[0]).toMatchObject({ pool: true, requireTLS: true, secure: false })
  })

  it("keeps the server's reply on a refusal, so a missing address counts as a hard bounce", async () => {
    refuse = Object.assign(new Error("Can't send mail - all recipients were rejected: 550-5.1.1 The email account that you tried to reach does not exist."), {
      code: 'EENVELOPE',
      responseCode: 550,
      response: '550-5.1.1 The email account that you tried to reach does not exist.',
    })
    const err: any = await smtpProvider.send(msg, creds).catch((e) => e)
    expect(err).toMatchObject({ code: 'EENVELOPE', responseCode: 550 })
    expect(isUnknownRecipient(err)).toBe(true)
  })

  it('a full mailbox is a refusal, not a missing address', async () => {
    refuse = Object.assign(new Error('Message failed: 552 5.2.2 Mailbox full'), { code: 'EMESSAGE', responseCode: 552, response: '552 5.2.2 Mailbox full' })
    const err: any = await smtpProvider.send(msg, creds).catch((e) => e)
    expect(err.responseCode).toBe(552)
    expect(isUnknownRecipient(err)).toBe(false)
  })
})
