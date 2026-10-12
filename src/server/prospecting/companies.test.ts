import { describe, expect, it } from 'vitest'
import { isCompanyName } from './companies'

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
