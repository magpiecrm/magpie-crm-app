import { describe, expect, it, vi } from 'vitest'
import { withProfileCache } from './profileCache'
import type { PeopleSource, PersonResult } from './types'

const person = (url: string): PersonResult => ({
  profileUrl: url, firstName: 'Jane', lastName: 'Smith', title: 'CFO', seniority: 'c_suite', company: 'Acme',
  companyRef: '7', companyDomain: null, country: 'United Kingdom', source: 'socialfetch',
})

function setup(opts: { max?: number } = {}) {
  let now = 0
  const getPerson = vi.fn(async (url: string) => (url.endsWith('/missing') ? null : person(url)))
  const source: PeopleSource = { searchPeople: vi.fn(), getPerson }
  const cached = withProfileCache(source, { ttlMs: 1_000, max: opts.max ?? 100, now: () => now })
  return { cached, getPerson, tick: (ms: number) => (now += ms) }
}

describe('withProfileCache', () => {
  it('pays for a profile once within the day', async () => {
    const { cached, getPerson, tick } = setup()
    await cached.getPerson('https://www.linkedin.com/in/jane')
    tick(999)
    expect(await cached.getPerson('https://www.linkedin.com/in/jane')).toMatchObject({ company: 'Acme' })
    expect(getPerson).toHaveBeenCalledTimes(1)
  })

  it('looks the profile up again once the entry has expired', async () => {
    const { cached, getPerson, tick } = setup()
    await cached.getPerson('https://www.linkedin.com/in/jane')
    tick(1_000)
    await cached.getPerson('https://www.linkedin.com/in/jane')
    expect(getPerson).toHaveBeenCalledTimes(2)
  })

  it('remembers "not found" but not a failed request', async () => {
    const { cached, getPerson } = setup()
    expect(await cached.getPerson('https://www.linkedin.com/in/missing')).toBeNull()
    expect(await cached.getPerson('https://www.linkedin.com/in/missing')).toBeNull()
    expect(getPerson).toHaveBeenCalledTimes(1)

    getPerson.mockRejectedValueOnce(new Error('SocialFetch did not respond'))
    await expect(cached.getPerson('https://www.linkedin.com/in/flaky')).rejects.toThrow()
    await cached.getPerson('https://www.linkedin.com/in/flaky')
    expect(getPerson).toHaveBeenCalledTimes(3)
  })

  it('shares one request between concurrent lookups of the same person', async () => {
    const { cached, getPerson } = setup()
    await Promise.all([cached.getPerson('https://www.linkedin.com/in/jane'), cached.getPerson('https://www.linkedin.com/in/jane')])
    expect(getPerson).toHaveBeenCalledTimes(1)
  })

  it('drops the oldest people beyond the size cap', async () => {
    const { cached, getPerson } = setup({ max: 2 })
    for (const h of ['a', 'b', 'c']) await cached.getPerson(`https://www.linkedin.com/in/${h}`)
    await cached.getPerson('https://www.linkedin.com/in/a')
    expect(getPerson).toHaveBeenCalledTimes(4)
  })

  it('hands out copies, so a caller changing a result does not change the cache', async () => {
    const { cached } = setup()
    const first = await cached.getPerson('https://www.linkedin.com/in/jane')
    first!.company = 'Changed'
    expect(await cached.getPerson('https://www.linkedin.com/in/jane')).toMatchObject({ company: 'Acme' })
  })
})
