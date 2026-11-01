import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The hosted service runs the finder itself. Importing db.ts opens a JSON
// database, so nothing the finder loads at runtime can reach it.
describe('the email finder', () => {
  it('can be imported without the app database', () => {
    for (const file of ['emailFinder.ts', 'patterns.ts', 'patternEvidence.ts', 'formatStats.ts', 'platformDomains.ts', 'proxyRouter.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      const runtime = source.split('\n').filter((line) => /^import (?!type )/.test(line))
      expect(runtime.filter((line) => /\.\.\/(db|usage|allowance|env)'/.test(line))).toEqual([])
    }
  })
})
