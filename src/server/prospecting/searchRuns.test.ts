import { beforeEach, describe, expect, it } from 'vitest'
import { forgetSearchRuns, joinSearch, type SearchLine } from './searchRuns'

type Page = { items: string[] }

/** A search whose batches and ending the test hands out by hand. */
function search() {
  let onPeople!: (found: { items: unknown[]; refined: string[] }) => void
  let finish!: (page: Page) => void
  let fail!: (err: Error) => void
  let started = 0
  const start = (emit: typeof onPeople) => {
    started++
    onPeople = emit
    return new Promise<Page>((resolve, reject) => ((finish = resolve), (fail = reject)))
  }
  return { start, found: (...names: string[]) => onPeople({ items: names, refined: [] }), finish: (page: Page) => finish(page), fail: (e: Error) => fail(e), started: () => started }
}
/** Someone listening: what reached them, and whether they're still there. */
function listener(here = true) {
  const got: Array<SearchLine<Page>> = []
  const state = { here }
  return { got, state, take: (line: SearchLine<Page>) => (state.here ? (got.push(line), true) : false), names: () => got.map((l) => (l.type === 'people' ? l.items.join(',') : l.type)) }
}
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => forgetSearchRuns())

describe('a people search that is asked for more than once', () => {
  it('is run once: a second request joins it, with the people found so far', async () => {
    const s = search()
    const first = listener()
    joinSearch('k', s.start, first.take)
    s.found('ana')
    const second = listener()
    joinSearch('k', s.start, second.take)
    s.found('ben')
    s.finish({ items: ['ana', 'ben'] })
    await settle()
    expect(s.started()).toBe(1)
    expect(first.names()).toEqual(['ana', 'ben', 'done'])
    expect(second.names()).toEqual(['ana', 'ben', 'done'])
    // Seen, so asking again is a new search.
    joinSearch('k', s.start, listener().take)
    expect(s.started()).toBe(2)
  })

  it('is kept when it finishes with nobody there, for whoever asks next', async () => {
    const s = search()
    const gone = listener()
    const leave = joinSearch('k', s.start, gone.take)
    s.found('ana')
    leave()
    s.found('ben')
    s.finish({ items: ['ana', 'ben'] })
    await settle()
    expect(gone.names()).toEqual(['ana'])
    const back = listener()
    joinSearch('k', s.start, back.take)
    expect(back.names()).toEqual(['ana', 'ben', 'done'])
    expect(s.started()).toBe(1)
    // Handed over once; and a connection that drops without saying so counts as nobody there.
    joinSearch('k', s.start, listener().take)
    expect(s.started()).toBe(2)
  })

  it("isn't handed to a listener whose connection has gone, and isn't kept past an hour", async () => {
    const s = search()
    const dropped = listener(false)
    joinSearch('k', s.start, dropped.take)
    s.finish({ items: ['ana'] })
    await settle()
    const later = listener()
    joinSearch('k', s.start, later.take, Date.now() + 61 * 60_000)
    expect(later.names()).toEqual([])
    expect(s.started()).toBe(2)
  })

  it('is asked for again after it fails, and different searches run apart', async () => {
    const s = search()
    const a = listener()
    joinSearch('k', s.start, a.take)
    s.fail(new Error('Out of credits'))
    await settle()
    expect(a.got.at(-1)).toEqual({ type: 'error', message: 'Out of credits' })
    joinSearch('k', s.start, listener().take)
    joinSearch('other', s.start, listener().take)
    expect(s.started()).toBe(3)
  })
})
