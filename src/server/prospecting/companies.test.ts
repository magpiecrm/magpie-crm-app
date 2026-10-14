import { describe, expect, it } from 'vitest'
import { isCompanyName, plainlySameCompany } from './companies'

describe('isCompanyName', () => {
  it("takes a typed employer for a company unless it only says what the person does", () => {
    for (const name of ['Umault', 'Curator', 'Avenue', 'The Creative Spot', 'Video Brothers', 'Creative Company', 'MediaFuel', 'Search Engine Optimization of PA', 'Clean Juice', 'Food Lion', 'Barzilay Associates']) {
      expect(isCompanyName(name), name).toBe(true)
    }
    for (const name of ['clean', 'Clean.', 'Clean Corp', 'Food Industry', 'the food industry', 'Real Estate', 'social media marketing', 'Hospitality sector', 'My own business', 'Self-employed', 'Freelance', 'N/A', 'IT']) {
      expect(isCompanyName(name), name).toBe(false)
    }
  })
})

describe('plainlySameCompany', () => {
  it('needs the name they share to tell firms apart', () => {
    const firm = 'MCS Management Consulting & Selection'
    for (const typed of ['MCS Inc', 'mcs', 'MCS', 'MCS Management Corp']) expect(plainlySameCompany(typed, firm, false)).toBe(false)
    expect(plainlySameCompany('MCS Management Consulting & Selection Ltd', firm, false)).toBe(true)
    expect(plainlySameCompany('Barclays UK', 'Barclays', false)).toBe(true)
    expect(plainlySameCompany('Acme Consulting', 'Acme', false)).toBe(true)
    // A three-letter firm is itself only by its page.
    expect(plainlySameCompany('MCS', 'MCS', false)).toBe(false)
    expect(plainlySameCompany('MCS', 'MCS', true)).toBe(true)
    expect(plainlySameCompany('MCS Inc', 'MCS', true)).toBe(true)
    expect(plainlySameCompany('MCS Global', 'MCS', true)).toBe(false)
    expect(plainlySameCompany('Other Firm', 'Acme', true)).toBe(false)
  })
})
