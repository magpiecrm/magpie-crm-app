import { describe, expect, it } from 'vitest'
import { bucketsForRange, DEFAULT_PERSONA_CRITERIA, normalizePersonaCriteria } from './types'

describe('bucketsForRange', () => {
  it.each([
    ['51-200', ['51-200']],
    ['100 - 1,000', ['51-200', '201-500', '501-1000']],
    ['5000+', ['1001-5000', '5001-10000', '10001+']],
    ['20', ['11-50']],
    ['', []],
    ['about fifty', []],
  ])('%s', (text, buckets) => {
    expect(bucketsForRange(text)).toEqual(buckets)
  })
})

describe('normalizePersonaCriteria', () => {
  it('converts a record from before personas matched search', () => {
    expect(
      normalizePersonaCriteria({
        title: ['VP Sales', ' Head of Sales ', 'VP Sales'],
        seniority: ['C-Level', 'VP', 'Wizard'],
        industry: ['Software Development', 'SaaS'],
        location: ['London, United Kingdom', 'United States'],
        employeeCount: '51-200',
        keywords: ['fintech', 'payments'],
        excludedTitles: ['Intern'],
      }),
    ).toEqual({
      titles: ['VP Sales', 'Head of Sales'],
      seniorities: ['c_suite', 'vp'],
      industries: ['Software Development'],
      companySizes: ['51-200'],
      country: 'United Kingdom',
      keyword: 'fintech',
    })
  })

  it('leaves a current record as it is', () => {
    const current = { titles: ['CMO'], seniorities: ['c_suite'], industries: ['Banking'], companySizes: ['11-50', '1-10'], country: 'Ireland', keyword: 'loans' }
    // Sizes come back in bucket order.
    expect(normalizePersonaCriteria(current)).toEqual({ ...current, companySizes: ['1-10', '11-50'] })
  })

  it('fills a missing or broken record with the defaults', () => {
    expect(normalizePersonaCriteria(undefined)).toEqual(DEFAULT_PERSONA_CRITERIA)
    expect(normalizePersonaCriteria({ titles: 'CMO', companySizes: ['huge'] })).toEqual(DEFAULT_PERSONA_CRITERIA)
  })
})
