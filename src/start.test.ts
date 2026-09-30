import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNREACHABLE, workspaceFetch } from './start'

const reply = (status: number, type: string | null) =>
  new Response(status === 204 ? null : 'x', { status, headers: type ? { 'content-type': type } : {} })

afterEach(() => vi.unstubAllGlobals())

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
