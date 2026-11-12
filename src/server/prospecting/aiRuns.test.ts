import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HELD_MS, WATCHED_MS, clearAiRun, forgetAiRuns, getAiRun, startAiRun, updateAiRun } from './aiRuns'

// AI work that outlives the request: kept until it's used or dismissed, joined
// rather than run twice, stopped when dismissed, and told of when it finishes
// with nobody watching.

const input = { websiteUrl: 'https://haulwise.test' }

/** Work that waits until it's told how to end. */
function pending<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  const work = vi.fn((signal: AbortSignal) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')))
    return promise
  })
  return { work, resolve, reject }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-11T09:00:00Z'))
})
afterEach(() => {
  forgetAiRuns()
  vi.useRealTimers()
})

describe('AI runs', () => {
  it('joins a run that is still going rather than starting a second, and keeps its answer', async () => {
    const ai = pending<string[]>()
    const first = startAiRun('personas', input, ai.work)
    const again = startAiRun('personas', { websiteUrl: 'https://other.test' }, ai.work)
    expect(again.id).toBe(first.id)
    expect(again.input).toEqual(input)
    await settle()
    expect(ai.work).toHaveBeenCalledTimes(1)
    expect(getAiRun('personas')?.status).toBe('running')

    ai.resolve(['a', 'b'])
    await settle()
    expect(getAiRun('personas')).toMatchObject({ id: first.id, status: 'done', result: ['a', 'b'] })
    // Each kind is its own.
    expect(getAiRun('search')).toBeNull()
  })

  it('tells of a run that finished with nobody watching, and not of one somebody was', async () => {
    const onUnseen = vi.fn()
    const unseen = pending<string>()
    startAiRun('personas', input, unseen.work, { onUnseen })
    vi.setSystemTime(Date.now() + WATCHED_MS + 1)
    unseen.resolve('drafts')
    await settle()
    expect(onUnseen).toHaveBeenCalledTimes(1)
    expect(onUnseen.mock.calls[0][0]).toMatchObject({ status: 'done', result: 'drafts' })

    const seen = pending<string>()
    startAiRun('search', input, seen.work, { onUnseen })
    vi.setSystemTime(Date.now() + 2 * WATCHED_MS)
    getAiRun('search')
    vi.setSystemTime(Date.now() + WATCHED_MS / 2)
    seen.resolve('filters')
    await settle()
    expect(onUnseen).toHaveBeenCalledTimes(1)
  })

  it('stops a run that is dismissed while it goes, keeps nothing of it, and tells of nothing', async () => {
    const onUnseen = vi.fn()
    const ai = pending<string>()
    const run = startAiRun('personas', input, ai.work, { onUnseen })
    await settle()
    vi.setSystemTime(Date.now() + 2 * WATCHED_MS)
    clearAiRun('personas', 'someone-else')
    expect(getAiRun('personas')?.id).toBe(run.id)
    clearAiRun('personas', run.id)
    const signal = ai.work.mock.calls[0][0]
    expect(signal.aborted).toBe(true)
    await settle()
    expect(getAiRun('personas')).toBeNull()
    expect(onUnseen).not.toHaveBeenCalled()
  })

  it('says why it failed, in words for the user where the AI could not finish', async () => {
    const failed = Object.assign(new Error('It was busy.'), { name: 'AiFailed' })
    startAiRun('personas', input, async () => {
      throw failed
    })
    await settle()
    expect(getAiRun('personas')).toMatchObject({ status: 'failed', error: "The AI couldn't finish: It was busy. Try again in a moment." })

    startAiRun('search', input, () => {
      throw new Error('No key.')
    })
    await settle()
    expect(getAiRun('search')).toMatchObject({ status: 'failed', error: 'No key.' })
  })

  it('replaces a finished run when asked again, and forgets one a day after it finished', async () => {
    const first = startAiRun('personas', input, async () => 'one')
    await settle()
    const second = startAiRun('personas', input, async () => 'two')
    expect(second.id).not.toBe(first.id)
    await settle()
    expect(getAiRun('personas')?.result).toBe('two')

    vi.setSystemTime(Date.now() + HELD_MS - 1000)
    expect(getAiRun('personas')).not.toBeNull()
    vi.setSystemTime(Date.now() + 2000)
    expect(getAiRun('personas')).toBeNull()
  })

  it('changes only the run it was asked about', async () => {
    const run = startAiRun<string[]>('personas', input, async () => ['a', 'b'])
    await settle()
    expect(updateAiRun('personas', 'gone', (r) => (r.added = [0]))).toBeNull()
    expect(updateAiRun<string[]>('personas', run.id, (r) => (r.added = [1]))?.added).toEqual([1])
    expect(getAiRun('personas')?.added).toEqual([1])
  })
})
