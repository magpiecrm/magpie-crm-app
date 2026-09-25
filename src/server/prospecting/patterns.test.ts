import { describe, expect, it } from 'vitest'
import { applyPattern, foldName, generateCandidates, inferPattern, nameVariants } from './patterns'
import { classifySeniority, parseSeniorityLabel } from './seniority'

const locals = (first: string, last: string, opts?: Parameters<typeof generateCandidates>[3]) =>
  generateCandidates(first, last, 'acme.com', opts).map((c) => c.email.split('@')[0])

describe('foldName', () => {
  it('folds accents and special letters to ASCII', () => {
    expect(foldName('José Müller')).toBe('jose muller')
    expect(foldName('Søren Ærø')).toBe('soren aero')
    expect(foldName('Łukasz Straße')).toBe('lukasz strasse')
    expect(foldName('Zoë Čapek')).toBe('zoe capek')
  })

  it('drops apostrophes and periods', () => {
    expect(foldName("O'Brien")).toBe('obrien')
    expect(foldName('D’Angelo')).toBe('dangelo')
    expect(foldName('St. John')).toBe('st john')
  })
})

describe('nameVariants', () => {
  it('handles a plain name', () => {
    expect(nameVariants('Jane', 'Smith')).toEqual({ first: ['jane'], last: ['smith'] })
  })

  it('joins, keeps and splits hyphenated surnames', () => {
    expect(nameVariants('Anna', 'Smith-Jones').last).toEqual(['smithjones', 'smith-jones', 'smith', 'jones'])
  })

  it('handles hyphenated first names', () => {
    expect(nameVariants('Jean-Pierre', 'Dupont').first).toEqual(['jeanpierre', 'jean-pierre', 'jean', 'pierre'])
  })

  it('keeps particles first, then offers the surname without them', () => {
    expect(nameVariants('Ludwig', 'van Beethoven').last).toEqual(['vanbeethoven', 'beethoven'])
    expect(nameVariants('Maria', 'de la Cruz').last).toEqual(['delacruz', 'cruz'])
  })

  it('handles multi-part surnames without particles', () => {
    expect(nameVariants('Gabriel', 'García Márquez').last).toEqual(['garciamarquez', 'garcia', 'marquez'])
  })

  it('strips titles, suffixes, credentials and bracketed notes', () => {
    expect(nameVariants('Dr. Sarah', 'Connor, PhD')).toEqual({ first: ['sarah'], last: ['connor'] })
    expect(nameVariants('John', 'Smith Jr.')).toEqual({ first: ['john'], last: ['smith'] })
    expect(nameVariants('Priya (she/her)', 'Patel 🚀')).toEqual({ first: ['priya'], last: ['patel'] })
  })

  it('splits a full name given only as the first name', () => {
    expect(nameVariants('Jane Smith', '')).toEqual({ first: ['jane'], last: ['smith'] })
  })

  it('keeps the first given name primary when there is a middle name', () => {
    expect(nameVariants('Mary Ann', 'Lee').first).toEqual(['mary', 'maryann'])
  })
})

describe('applyPattern', () => {
  it('fills every token', () => {
    expect(applyPattern('{first}.{last}', 'jane', 'smith')).toBe('jane.smith')
    expect(applyPattern('{f}{last}', 'jane', 'smith')).toBe('jsmith')
    expect(applyPattern('{last}{f}', 'jane', 'smith')).toBe('smithj')
    expect(applyPattern('{f}{l}', 'jane', 'smith')).toBe('js')
  })

  it('refuses patterns that need a missing part', () => {
    expect(applyPattern('{first}.{last}', 'jane', '')).toBeNull()
    expect(applyPattern('{first}', 'jane', '')).toBe('jane')
  })
})

describe('generateCandidates', () => {
  it('ranks the common patterns first', () => {
    // Most common first (Sendburg 2025): first.last, flast, first, firstlast, first_last, f.last…
    expect(locals('Jane', 'Smith').slice(0, 8)).toEqual([
      'jane.smith', 'jsmith', 'jane', 'janesmith', 'jane_smith', 'j.smith', 'smith', 'smith.jane',
    ])
  })

  it('never produces duplicates and respects max', () => {
    const out = locals('Anna', 'Smith-Jones', { max: 20 })
    expect(new Set(out).size).toBe(out.length)
    expect(locals('Anna', 'Smith-Jones', { max: 3 })).toHaveLength(3)
  })

  it('tries alternate surname spellings for the top patterns', () => {
    const out = locals('Anna', 'Smith-Jones', { max: 30 })
    expect(out[0]).toBe('anna.smithjones')
    expect(out).toContain('anna.smith-jones')
    expect(out).toContain('anna.jones')
    expect(out).toContain('asmith')
  })

  it('puts a known pattern first', () => {
    expect(locals('Jane', 'Smith', { knownPattern: '{last}{f}' })[0]).toBe('smithj')
  })

  it('produces nothing for a name with no usable letters', () => {
    expect(generateCandidates('🙂', '', 'acme.com')).toEqual([])
  })

  it('works for accented and apostrophe names end to end', () => {
    expect(generateCandidates('Siobhán', "O'Néill", 'acme.ie')[0].email).toBe('siobhan.oneill@acme.ie')
  })
})

describe('inferPattern', () => {
  it('recovers the pattern from a verified address', () => {
    expect(inferPattern('jsmith@acme.com', 'Jane', 'Smith')).toBe('{f}{last}')
    expect(inferPattern('nobody@acme.com', 'Jane', 'Smith')).toBeNull()
  })
})

describe('classifySeniority', () => {
  it.each([
    ['Founder & CEO', 'founder'],
    ['Chief Revenue Officer', 'c_suite'],
    ['Managing Director', 'c_suite'],
    ['Vice President, Sales', 'vp'],
    ['SVP Engineering', 'vp'],
    ['Head of Marketing', 'head'],
    ['Senior Director of Product', 'director'],
    ['Senior Product Manager', 'manager'],
    ['Staff Engineer', 'senior'],
    ['Junior Analyst', 'entry'],
    ['Marketing Intern', 'intern'],
    ['Owner', 'owner'],
    ['Account Executive', null],
    ['', null],
  ])('%s -> %s', (title, expected) => {
    expect(classifySeniority(title)).toBe(expected)
  })

  it('maps persona labels', () => {
    expect(parseSeniorityLabel('C-Level')).toBe('c_suite')
    expect(parseSeniorityLabel('VP')).toBe('vp')
    expect(parseSeniorityLabel('Wizard')).toBeNull()
  })
})
