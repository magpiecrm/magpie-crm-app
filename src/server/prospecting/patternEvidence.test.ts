import { describe, expect, it } from 'vitest'
import { formatPrior } from './formatStats'
import { weighFormats, type KnownAddress } from './patternEvidence'

const at = (email: string, name: string, kind: KnownAddress['kind'] = 'known'): KnownAddress => {
  const [firstName, lastName] = name.split(' ')
  return { email: `${email}@acme.com`, firstName, lastName, kind }
}

describe('weighFormats', () => {
  it('lifts a format from its prior with each address that matches it', () => {
    expect(weighFormats([at('bob.jones', 'Bob Jones')])).toMatchObject({ pattern: '{first}.{last}', agree: 1, against: 0 })
    expect(weighFormats([at('bob.jones', 'Bob Jones')])!.confidence).toBeCloseTo(0.74, 2)
    const three = weighFormats([at('bob.jones', 'Bob Jones'), at('ann.lee', 'Ann Lee'), at('tom.hart', 'Tom Hart')])
    expect(three!.confidence).toBeCloseTo(0.87, 2)
  })

  it('picks the format most addresses use, and lets the others count against it', () => {
    const result = weighFormats([at('bjones', 'Bob Jones'), at('alee', 'Ann Lee'), at('thart', 'Tom Hart'), at('sue.ray', 'Sue Ray')])
    expect(result).toMatchObject({ pattern: '{f}{last}', agree: 3, against: 1 })
    expect(result!.confidence).toBeCloseTo((3 + 0.268) / 5, 3)
  })

  it('counts a bounce against its format, and an engaged guess for it', () => {
    const clean = weighFormats([at('bob.jones', 'Bob Jones'), at('ann.lee', 'Ann Lee', 'engaged')])!
    const bounced = weighFormats([at('bob.jones', 'Bob Jones'), at('ann.lee', 'Ann Lee', 'engaged'), at('tom.hart', 'Tom Hart', 'bounced')])!
    expect(clean).toMatchObject({ agree: 2, against: 0 })
    expect(bounced).toMatchObject({ agree: 2, against: 1 })
    expect(bounced.confidence).toBeLessThan(clean.confidence)
  })

  it('ignores addresses that match no format, and has nothing to say without any', () => {
    expect(weighFormats([at('sales', 'Bob Jones'), at('info', 'Ann Lee')])).toBeNull()
    expect(weighFormats([])).toBeNull()
    // Only bounces: no real address backs any format.
    expect(weighFormats([at('bob.jones', 'Bob Jones', 'bounced')])).toBeNull()
  })

  it('counts one address once', () => {
    expect(weighFormats([at('bob.jones', 'Bob Jones'), at('BOB.JONES', 'Bob Jones')])).toMatchObject({ agree: 1 })
  })
})

describe('formatPrior', () => {
  it('scales first.last by company size and uses the overall share otherwise', () => {
    expect(formatPrior('{first}.{last}', 20000)).toBeCloseTo(0.742, 3)
    expect(formatPrior('{first}.{last}')).toBeCloseTo(0.477, 3)
    expect(formatPrior('{f}{last}', 20000)).toBeCloseTo(0.268, 3)
    expect(formatPrior('{last}{f}')).toBeCloseTo(0.0005, 4)
  })
})
