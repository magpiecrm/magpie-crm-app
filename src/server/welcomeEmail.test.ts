import { describe, expect, it, vi } from 'vitest'

vi.mock('./db', () => ({ db: {} }))
vi.mock('./nodemailer', () => ({ sendMail: vi.fn() }))

const { withUnsubscribeLink } = await import('./emailScheduler')

describe('welcome emails', () => {
  it('put the unsubscribe link where the design asks for it, or at the bottom', () => {
    const url = 'https://app.test/api/unsubscribe?t=abc'
    expect(withUnsubscribeLink('<p>Hi</p><a href="{{ unsubscribe }}">Leave</a>', url)).toBe(`<p>Hi</p><a href="${url}">Leave</a>`)
    const footed = withUnsubscribeLink('<html><body><p>Hi</p></body></html>', url)
    expect(footed).toContain(`<a href="${url}"`)
    expect(footed.indexOf(url)).toBeLessThan(footed.indexOf('</body>'))
    expect(withUnsubscribeLink('<p>Hi</p>', url)).toMatch(/Unsubscribe<\/a><\/div>$/)
  })
})
