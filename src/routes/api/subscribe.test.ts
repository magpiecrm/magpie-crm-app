import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The route imports db.ts, which reads DATABASE_PATH at module load, so point
// it at a scratch file before the dynamic import.
const scratchDir = mkdtempSync(join(tmpdir(), 'subscribe-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { Route } = await import('./subscribe')
const handlers = (Route as any).options.server.handlers

const originalAllowed = process.env.SUBSCRIBE_ALLOWED_ORIGINS

afterEach(() => {
  if (originalAllowed === undefined) delete process.env.SUBSCRIBE_ALLOWED_ORIGINS
  else process.env.SUBSCRIBE_ALLOWED_ORIGINS = originalAllowed
})

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const preflight = (origin: string) =>
  handlers.OPTIONS({ request: new Request('http://app.test/api/subscribe', { method: 'OPTIONS', headers: { origin } }) })

describe('/api/subscribe CORS', () => {
  it('allows no origin when SUBSCRIBE_ALLOWED_ORIGINS is unset', async () => {
    delete process.env.SUBSCRIBE_ALLOWED_ORIGINS
    const res = await preflight('https://a.test')
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('echoes an origin that is on the allowlist', async () => {
    process.env.SUBSCRIBE_ALLOWED_ORIGINS = 'https://a.test,https://b.test'
    const res = await preflight('https://b.test')
    expect(res.headers.get('access-control-allow-origin')).toBe('https://b.test')
  })

  it('omits the header for an origin that is not on the allowlist', async () => {
    process.env.SUBSCRIBE_ALLOWED_ORIGINS = 'https://a.test'
    const res = await preflight('https://evil.test')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('still rejects a POST without an API key, with CORS headers the browser can read', async () => {
    process.env.SUBSCRIBE_ALLOWED_ORIGINS = 'https://a.test'
    const res = await handlers.POST({
      request: new Request('http://app.test/api/subscribe', {
        method: 'POST',
        headers: { origin: 'https://a.test', 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'someone@a.test' }),
      }),
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://a.test')
  })
})
