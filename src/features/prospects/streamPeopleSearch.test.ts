import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamPeopleSearch } from './streamPeopleSearch'

// The page reads a streamed search: each batch of people as it comes, then the finished page.

const person = (handle: string) => ({ profileUrl: `https://www.linkedin.com/in/${handle}`, firstName: handle, lastName: 'Smith' })
function reply(chunks: string[], status = 200) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk))
      c.close()
    },
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))
}
afterEach(() => vi.unstubAllGlobals())

describe('streamPeopleSearch', () => {
  it('hands over each batch as it arrives, even split mid-line, and resolves with the finished page', async () => {
    const people = JSON.stringify({ type: 'people', items: [person('ana')], refined: ['https://www.linkedin.com/in/ana'] }) + '\n'
    const more = JSON.stringify({ type: 'people', items: [person('ben')], refined: [] }) + '\n'
    const done = JSON.stringify({ type: 'done', page: { items: [person('ana'), person('ben')], nextCursor: 'c2', reportedTotal: null, warnings: [], refined: [], resumed: false } }) + '\n'
    reply([people.slice(0, 20), people.slice(20) + more.slice(0, 5), more.slice(5), done])
    const found: string[][] = []
    const page = await streamPeopleSearch({ titles: ['Founder'] }, (f) => found.push(f.items.map((p) => p.firstName)))
    expect(found).toEqual([['ana'], ['ben']])
    expect(page.nextCursor).toBe('c2')
    const [url, init] = (fetch as any).mock.calls[0]
    expect(url).toBe('/api/prospects/search')
    expect(JSON.parse(init.body)).toEqual({ titles: ['Founder'] })
  })

  it("fails with the search's own message", async () => {
    reply([JSON.stringify({ type: 'error', message: 'Add your SocialFetch key in Settings → Data source.' }) + '\n'])
    await expect(streamPeopleSearch({ titles: ['Founder'] }, () => {})).rejects.toThrow('Add your SocialFetch key in Settings → Data source.')
  })

  it('fails plainly when the reply ends before the search finished, or is refused', async () => {
    reply([JSON.stringify({ type: 'people', items: [person('ana')], refined: [] }) + '\n'])
    await expect(streamPeopleSearch({ titles: ['Founder'] }, () => {})).rejects.toThrow('The search stopped before it finished. Try again.')
    reply(['Unauthorized'], 401)
    await expect(streamPeopleSearch({ titles: ['Founder'] }, () => {})).rejects.toThrow('Your session has ended. Sign in again.')
  })
})
