import { describe, expect, it } from 'vitest'
import { firstLastLikelihood } from './formatStats'
import { domainFromSoaContact, suggestMailDomain } from './mailDomainHint'

describe('domainFromSoaContact', () => {
  it('strips the mailbox label', () => {
    expect(domainFromSoaContact('dnsadmin.jaguarlandrover.com')).toBe('jaguarlandrover.com')
    expect(domainFromSoaContact('hostmaster.acme.co.uk.')).toBe('acme.co.uk')
    expect(domainFromSoaContact('admin.it.acme.com')).toBe('acme.com')
    expect(domainFromSoaContact('localhost')).toBeNull()
  })
})

describe('suggestMailDomain', () => {
  // SOA contacts as observed live on 2026-09-25.
  const soa: Record<string, string> = {
    'jlr.com': 'dnsadmin.jaguarlandrover.com',
    'natwest.com': 'premiumdns.support.neustar',
    'boohoogroup.com': 'hostmaster.eurodns.com',
    'peterleymanorfarm.co.uk': 'dns.jomax.net',
    'mastercard.com': 'hostmaster.mastercard.com',
    'shop.acme.com': 'hostmaster.acme.com',
    'nomail.com': 'dns.somewhere-else.com',
  }
  const mx: Record<string, string[]> = { 'jaguarlandrover.com': ['jaguarlandrover-com.mail.protection.outlook.com'] }
  const deps = {
    resolveSoaContact: async (d: string) => soa[d] ?? null,
    resolveMx: async (d: string) => mx[d] ?? [],
  }

  it('suggests the domain named by the DNS admin contact when it takes email', async () => {
    expect(await suggestMailDomain('jlr.com', deps)).toBe('jaguarlandrover.com')
  })

  it('ignores DNS hosts, the same organisation, and domains without mail', async () => {
    for (const d of ['natwest.com', 'boohoogroup.com', 'peterleymanorfarm.co.uk', 'mastercard.com', 'shop.acme.com', 'nomail.com']) {
      expect(await suggestMailDomain(d, deps)).toBeNull()
    }
  })

  it('never throws on DNS errors', async () => {
    const broken = { resolveSoaContact: async () => { throw new Error('SERVFAIL') }, resolveMx: deps.resolveMx }
    expect(await suggestMailDomain('jlr.com', broken)).toBeNull()
  })
})

describe('firstLastLikelihood', () => {
  it('uses the company-size band', () => {
    expect(firstLastLikelihood(20000)).toBe('About 74% of people at companies of 10,000+ people use this format.')
    expect(firstLastLikelihood(8)).toBe('About 38% of people at companies of 1–10 people use this format.')
    expect(firstLastLikelihood(null)).toBe('About 48% of work emails use this format.')
  })
})
