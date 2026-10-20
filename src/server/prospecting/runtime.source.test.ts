import { afterEach, describe, expect, it } from 'vitest'
import { getSource } from './runtime'

// Which people search a hosted copy uses: with the host's web people search on, the web's by job title
// alone and SocialFetch's for searches with company filters; with it off, SocialFetch's for both.
const ENV = { PROSPECTING_MANAGED: 'on', REACHER_URL: 'https://services.magpie.test', REACHER_SECRET: 'vt_mc_acme', SOCIALFETCH_BASE_URL: 'https://services.magpie.test' }
const hosted = (webPeopleSearch: boolean) => {
  Object.assign(process.env, ENV)
  ;(globalThis as any).__hostRules = { rules: {}, webSearch: true, webPeopleSearch }
}

describe('getSource', () => {
  afterEach(() => {
    for (const k of Object.keys(ENV)) delete process.env[k]
    delete (globalThis as any).__hostRules
  })

  it('mixes the web search by title with SocialFetch for searches with company filters, where the host has web people search on', () => {
    hosted(true)
    const byTitle = getSource()
    const withCompanies = getSource({ companies: true })
    expect(byTitle).not.toBe(withCompanies)
    // The web source takes its own batches; SocialFetch's are its 20 (search.ts).
    expect(byTitle.companiesPerSearch).toBeGreaterThan(20)
    expect(withCompanies.companiesPerSearch).toBeUndefined()
  })

  it('is SocialFetch for every search where the host has it off', () => {
    hosted(false)
    expect(getSource()).toBe(getSource({ companies: true }))
    expect(getSource().companiesPerSearch).toBeUndefined()
  })
})
