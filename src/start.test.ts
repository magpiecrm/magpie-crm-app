import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OTHER_SITE_REFUSED, UNREACHABLE, startInstance, workspaceFetch } from './start'

const reply = (status: number, type: string | null) =>
  new Response(status === 204 ? null : 'x', { status, headers: type ? { 'content-type': type } : {} })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** Runs the first request middleware on a call to this address, as the server would. */
async function call(headers: Record<string, string>, { url = 'http://hq.example.com/_serverFn/x', handlerType = 'serverFn', method = 'POST' } = {}) {
  const options = await startInstance.getOptions()
  const [middleware] = options.requestMiddleware as unknown as [{ options: { server: (ctx: unknown) => Promise<Response> } }]
  return middleware.options.server({
    request: new Request(url, { method, headers }),
    pathname: new URL(url).pathname,
    context: {},
    handlerType,
    next: async () => new Response('ran'),
  })
}

const refused = async (res: Response) => res.status === 403 && (await res.text()) === OTHER_SITE_REFUSED
const ran = async (res: Response) => res.status === 200 && (await res.text()) === 'ran'
const caddy = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'hq.example.com' }

describe('server function calls from elsewhere', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it("lets this copy's own pages through", async () => {
    expect(await ran(await call({ 'sec-fetch-site': 'same-origin', origin: 'http://hq.example.com' }))).toBe(true)
    expect(await ran(await call({ 'sec-fetch-site': 'same-origin' }, { method: 'GET' }))).toBe(true)
  })

  it('refuses another site, and a sibling subdomain, which counts as the same site', async () => {
    expect(await refused(await call({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }))).toBe(true)
    expect(await refused(await call({ 'sec-fetch-site': 'same-site', origin: 'https://other.example.com' }))).toBe(true)
    expect(await refused(await call({ 'sec-fetch-site': 'cross-site' }, { method: 'GET' }))).toBe(true)
  })

  it('refuses a call that says nothing about where it came from', async () => {
    expect(await refused(await call({}))).toBe(true)
  })

  it('goes by Origin and Referer for a browser with no Sec-Fetch-Site, behind a proxy or not', async () => {
    expect(await ran(await call({ origin: 'http://hq.example.com' }))).toBe(true)
    // Behind Caddy the request reads http://, where the browser used https.
    expect(await ran(await call({ ...caddy, origin: 'https://hq.example.com' }))).toBe(true)
    expect(await ran(await call({ ...caddy, referer: 'https://hq.example.com/marketing/lists' }))).toBe(true)
    const others: Record<string, string>[] = [
      { origin: 'https://evil.example' },
      { origin: 'http://hq.example.com.evil.example' },
      { referer: 'https://other.example.com/page' },
      // A plain http page on the same name isn't the https site.
      { origin: 'http://hq.example.com' },
    ]
    for (const bad of others) {
      expect(await refused(await call({ ...caddy, ...bad }))).toBe(true)
    }
  })

  it('takes the first entry when proxies are chained', async () => {
    expect(await ran(await call({ 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'hq.example.com, inner', origin: 'https://hq.example.com' }))).toBe(true)
  })

  it('accepts PUBLIC_URL, for a proxy that changes the Host', async () => {
    vi.stubEnv('PUBLIC_URL', 'https://crm.example.com/')
    expect(await ran(await call({ origin: 'https://crm.example.com' }, { url: 'http://app:3000/_serverFn/x' }))).toBe(true)
  })

  it('leaves routes alone: the public and token ones are called from elsewhere', async () => {
    const elsewhere = { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }
    expect(await ran(await call(elsewhere, { url: 'http://hq.example.com/api/subscribe', handlerType: 'router' }))).toBe(true)
  })
})

describe('workspaceFetch', () => {
  it("passes the app's own replies through, errors included", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(500, 'application/json')))
    expect((await workspaceFetch('/_serverFn/x')).status).toBe(500)
  })

  it('says the workspace is unreachable for a dropped connection or a proxy error page while it restarts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(workspaceFetch('/_serverFn/x')).rejects.toThrow(UNREACHABLE)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 502 })))
    await expect(workspaceFetch('/_serverFn/x')).rejects.toThrow(UNREACHABLE)
    vi.stubGlobal('fetch', vi.fn(async () => reply(502, 'text/plain')))
    await expect(workspaceFetch('/_serverFn/x')).rejects.toThrow(UNREACHABLE)
    vi.stubGlobal('fetch', vi.fn(async () => reply(503, 'text/html; charset=utf-8')))
    await expect(workspaceFetch('/_serverFn/x')).rejects.toThrow(UNREACHABLE)
  })

  it('lets a cancelled request stay cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    await expect(workspaceFetch('/_serverFn/x')).rejects.toThrow('aborted')
  })
})
