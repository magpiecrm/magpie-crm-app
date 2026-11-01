import { describe, expect, it } from 'vitest'
import { viewOnlyMayCall } from './viewOnly'

const fn = (name: string, filename = 'src/server/functions/contacts.ts') => ({ name, filename })

describe('viewOnlyMayCall', () => {
  it('lets reads through', () => {
    expect(viewOnlyMayCall('GET', fn('contactsFn'))).toBe(true)
  })

  it('refuses anything else that is not listed, so a new one is refused too', () => {
    expect(viewOnlyMayCall('POST', fn('addContactFn'))).toBe(false)
    expect(viewOnlyMayCall('POST', fn('someFunctionNobodyHasWrittenYet'))).toBe(false)
  })

  it('lets signing out and the read that takes a big body through', () => {
    expect(viewOnlyMayCall('POST', fn('logoutFn', 'src/server/functions/auth.ts'))).toBe(true)
    expect(viewOnlyMayCall('POST', fn('previewSequenceStepFn', 'src/server/functions/sequences.ts'))).toBe(true)
  })

  it('goes by file as well as name, since a name can repeat across files', () => {
    expect(viewOnlyMayCall('POST', fn('logoutFn', 'src/server/functions/contacts.ts'))).toBe(false)
  })
})
