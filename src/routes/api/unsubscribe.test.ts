import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The route imports db.ts, which reads DATABASE_PATH at module load, so point
// it at a scratch file before the dynamic import.
const scratchDir = mkdtempSync(join(tmpdir(), 'unsubscribe-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { Route } = await import('./unsubscribe')
const { encryptToken } = await import('../../server/crypto')
const handlers = (Route as any).options.server.handlers

const originalSiteUrl = process.env.PUBLIC_SITE_URL

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.PUBLIC_SITE_URL
  else process.env.PUBLIC_SITE_URL = originalSiteUrl
})

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const renderPage = async () => {
  const token = encodeURIComponent(encryptToken({ email: 'someone@a.test' }))
  const res = await handlers.GET({ request: new Request(`http://app.test/api/unsubscribe?t=${token}`) })
  expect(res.status).toBe(200)
  return res.text() as Promise<string>
}

describe('/api/unsubscribe back-to-site link', () => {
  it('renders no link and no redirect when PUBLIC_SITE_URL is unset', async () => {
    delete process.env.PUBLIC_SITE_URL
    const html = await renderPage()
    expect(html).toContain('Unsubscribed Successfully')
    expect(html).not.toContain('Back to website')
    expect(html).not.toContain('You will be redirected')
    expect(html).not.toMatch(/window\.location\.href\s*=/)
  })

  it('links and redirects to a configured https site', async () => {
    process.env.PUBLIC_SITE_URL = 'https://www.a.test'
    const html = await renderPage()
    expect(html).toContain('<a href="https://www.a.test/"')
    expect(html).toContain('Back to website')
    expect(html).toContain('window.location.href = "https://www.a.test/"')
  })

  it('ignores a javascript: URL rather than turning it into a link', async () => {
    process.env.PUBLIC_SITE_URL = 'javascript:alert(1)'
    const html = await renderPage()
    expect(html).not.toContain('javascript:alert')
    expect(html).not.toContain('Back to website')
  })

  it('cannot break out of the inline script with a crafted URL', async () => {
    process.env.PUBLIC_SITE_URL = 'https://a.test/"</script><script>alert(1)</script>'
    const html = await renderPage()
    expect(html).not.toContain('<script>alert(1)')
    expect(html).not.toContain('"</script>')
  })
})

describe('/api/unsubscribe one-click (RFC 8058)', () => {
  it("unsubscribes from a mail client's form post, with the token in the link", async () => {
    const { db } = await import('../../server/db')
    db.data.contacts.push({ email: 'someone@a.test', first_name: '', last_name: '', job_title: '', company: '', status: 'subscribed', created_at: '' })
    const token = encodeURIComponent(encryptToken({ email: 'someone@a.test' }))
    const res = await handlers.POST({
      request: new Request(`http://app.test/api/unsubscribe?t=${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
    })
    expect(res.status).toBe(200)
    expect(db.getContact('someone@a.test')?.status).toBe('unsubscribed')
  })

  it('refuses a one-click post without a valid token', async () => {
    const res = await handlers.POST({
      request: new Request('http://app.test/api/unsubscribe?t=nonsense', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
    })
    expect(res.status).toBe(400)
  })
})
