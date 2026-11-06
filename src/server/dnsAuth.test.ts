import { describe, expect, it } from 'vitest'

// Fresh module each time: answers are kept for a while.
const fresh = async () => {
  const { vi } = await import('vitest')
  vi.resetModules()
  return import('./dnsAuth')
}

describe('dblListed', () => {
  it("says it couldn't check when Spamhaus doesn't answer, rather than all clear", async () => {
    const { dblListed } = await fresh()
    expect(await dblListed(['acme.test'], { resolve4: async () => [] })).toEqual({ checked: false, listed: [] })
  })

  it('lists the domains on the blocklist', async () => {
    const { dblListed } = await fresh()
    const resolve4 = async (name: string) => (name === 'dbltest.com.dbl.spamhaus.org' || name === 'bad.test.dbl.spamhaus.org' ? ['127.0.1.2'] : [])
    expect(await dblListed(['acme.test', 'BAD.test'], { resolve4 })).toEqual({ checked: true, listed: ['bad.test'] })
  })

  it("treats Spamhaus refusing a lookup as couldn't check, not listed", async () => {
    const { dblListed } = await fresh()
    expect(await dblListed(['acme.test'], { resolve4: async () => ['127.255.255.254'] })).toEqual({ checked: false, listed: [] })
  })
})

describe('authRecords', () => {
  it('finds SPF, and DMARC on the domain or its organisation', async () => {
    const { authRecords } = await fresh()
    const txt: Record<string, string[][]> = { 'mail.acme.test': [['v=spf1 include:x -all']], '_dmarc.acme.test': [['v=DMARC1; p=none']] }
    expect(await authRecords('mail.acme.test', { resolveTxt: async (n) => txt[n] ?? [] })).toMatchObject({ spf: true, dmarc: true })
    expect(await authRecords('other.test', { resolveTxt: async () => [] })).toMatchObject({ spf: false, dmarc: false })
  })
})
