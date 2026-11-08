import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { criteriaOf, targetShape, whoOf } from './aiTargets'
import { draftAnswer } from './personaDraft'
import { suggestionAnswer } from './searchSuggest'

// What the AI gives back when it turns a website into people search filters:
// the companies first, then the people, every one a search that can run.

const good = {
  companies: 'Hauliers in the UK with their own fleets.',
  industries: ['Truck Transportation'],
  companySizes: ['51-200', '201-500'],
  country: 'United Kingdom',
  keyword: '',
  people: 'Their operations leaders choose the planning tools.',
  titles: ['Operations leaders'],
  seniorities: [],
}

const target = z.object(targetShape)
const problem = (change: Partial<Record<keyof typeof good, unknown>>) => {
  const parsed = target.safeParse({ ...good, ...change })
  return parsed.success ? null : parsed.error.issues.map((i) => i.path.join('.')).join(', ')
}

describe('a target from the AI', () => {
  it('asks for the companies before the people, in both answers', () => {
    const order = ['companies', 'industries', 'companySizes', 'country', 'keyword', 'people', 'titles', 'seniorities']
    expect(Object.keys((z.toJSONSchema(target) as any).properties)).toEqual(order)
    const persona = (z.toJSONSchema(draftAnswer) as any).properties.personas.items.properties
    expect(Object.keys(persona).slice(0, order.length)).toEqual(order)
    expect(Object.keys((z.toJSONSchema(suggestionAnswer) as any).properties)).toEqual(order)
  })

  it('needs real company criteria and someone to reach there', () => {
    expect(problem({})).toBeNull()
    expect(problem({ industries: [] })).toBe('industries')
    expect(problem({ companySizes: [] })).toBe('companySizes')
    expect(problem({ titles: [] })).toBe('titles')
    expect(problem({ companies: ' ' })).toBe('companies')
    expect(problem({ people: '' })).toBe('people')
    // A keyword is optional; one that describes no company in particular is refused.
    expect(problem({ keyword: 'freight forwarding' })).toBeNull()
    expect(problem({ keyword: 'B2B' })).toBe('keyword')
    expect(problem({ keyword: 'Services' })).toBe('keyword')
  })

  it('takes only the values search uses', () => {
    expect(problem({ industries: ['Haulage'] })).toBe('industries.0')
    expect(problem({ country: 'Atlantis' })).toBe('country')
    expect(problem({ country: '' })).toBeNull()
    expect(problem({ companySizes: ['50-100'] })).toBe('companySizes.0')
    expect(problem({ seniorities: ['boss'] })).toBe('seniorities.0')
    expect(problem({ titles: ['CEO', 'CFO', 'COO', 'CTO', 'CMO', 'CRO'] })).toBe('titles')
    expect(problem({ industries: ['Truck Transportation', 'Maritime Transportation', 'Logistics and Supply Chain', 'Transportation, Logistics, Supply Chain and Storage'] })).toBe('industries')
  })

  it('becomes search filters, and a passage on who', () => {
    const t = target.parse({ ...good, companySizes: ['201-500', '51-200'] })
    expect(criteriaOf(t)).toEqual({ titles: ['Operations leaders'], seniorities: [], industries: ['Truck Transportation'], companySizes: ['51-200', '201-500'], country: 'United Kingdom', keyword: '' })
    expect(whoOf(t)).toBe('Hauliers in the UK with their own fleets. Their operations leaders choose the planning tools.')
  })
})
