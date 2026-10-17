import { describe, expect, it } from 'vitest'
import { anyOf, countrySite, phrase, profileSite, readListing } from './linkedinResults'
import { fitsTitles } from './socialfetch'
import { classifySeniority } from './seniority'
import type { WebResult } from './webSearch'

// Made-up people, in the shapes Google's results for LinkedIn profiles took
// through Decodo (checked against 145 profile results on 2026-10-17).
const r = (url: string, title: string, description = '', info?: string[]): WebResult => ({ url, title, description, ...(info ? { info } : {}) })
const fits = fitsTitles(['Founder', 'Head of Sales', 'Sales Manager'])
const isTitle = (t: string) => fits(t) || classifySeniority(t) !== null

describe('readListing', () => {
  it('reads the location, title and employer Google lists under a profile', () => {
    const l = readListing(
      r('https://uk.linkedin.com/in/jane-larkin-1a2b3c', 'Jane Larkin - Larkspur Labs | LinkedIn', 'Jane builds things …', ['Leeds, England, United Kingdom', 'Founder & CEO', 'Larkspur Labs']),
      isTitle,
    )
    expect(l).toEqual({
      profileUrl: 'https://www.linkedin.com/in/jane-larkin-1a2b3c',
      firstName: 'Jane',
      lastName: 'Larkin',
      jobTexts: ['Founder & CEO'],
      title: 'Founder & CEO',
      company: 'Larkspur Labs',
      country: 'United Kingdom',
    })
  })

  it('splits "Title at Company" in the result title', () => {
    const l = readListing(r('https://www.linkedin.com/in/omar-quill', 'Omar Quill - Head of Sales at Quillon Systems | LinkedIn'), isTitle)
    expect(l).toMatchObject({ firstName: 'Omar', lastName: 'Quill', title: 'Head of Sales', company: 'Quillon Systems', country: null })
  })

  it('takes "Name - Title - Company" too', () => {
    expect(readListing(r('https://www.linkedin.com/in/ana-vale', 'Ana Vale - Sales Manager - Valewood Ltd | LinkedIn'), isTitle)).toMatchObject({ title: 'Sales Manager', company: 'Valewood Ltd' })
  })

  it('takes "Name - X" for the employer only when X isn’t a job title', () => {
    expect(readListing(r('https://www.linkedin.com/in/ben-tor', 'Ben Tor - Torbridge Analytics | LinkedIn'), isTitle)).toMatchObject({ company: 'Torbridge Analytics', title: '' })
    expect(readListing(r('https://www.linkedin.com/in/ben-tor', 'Ben Tor - Founder | LinkedIn'), isTitle)).toMatchObject({ company: '', title: 'Founder' })
  })

  it('leaves out an employer or title Google cut short', () => {
    const l = readListing(r('https://www.linkedin.com/in/cara-mint', 'Cara Mint - Head of Sales at Mintleaf Software and ...'), isTitle)
    expect(l).toMatchObject({ company: '', title: '' })
  })

  it('reads "Experience:" and "Location:" from the snippet when nothing else says', () => {
    const l = readListing(r('https://www.linkedin.com/in/dev-oak', 'Dev Oak - Founder | LinkedIn', 'Founder of things. Experience: Oakfield Studio · Education: Somewhere · Location: Bristol, England, United Kingdom · 500+ connections'), isTitle)
    expect(l).toMatchObject({ company: 'Oakfield Studio', country: 'United Kingdom' })
  })

  it('cleans the name, and skips what isn’t a profile', () => {
    expect(readListing(r('https://www.linkedin.com/in/eve-ash', 'Dr. Eve Ash, MBA (she/her) - Founder at Ashgrove | LinkedIn'), isTitle)).toMatchObject({ firstName: 'Eve', lastName: 'Ash' })
    expect(readListing(r('https://www.linkedin.com/company/ashgrove', 'Ashgrove | LinkedIn'), isTitle)).toBeNull()
    expect(readListing(r('https://example.com/team', 'Our team'), isTitle)).toBeNull()
  })

  it('takes the country from a country site when there’s no location', () => {
    expect(readListing(r('https://de.linkedin.com/in/fritz-berg', 'Fritz Berg - Sales Manager at Bergwerk GmbH | LinkedIn'), isTitle)?.country).toBe('Germany')
  })
})

describe('query pieces', () => {
  it('quotes phrases and ORs them in brackets', () => {
    expect(phrase('Head of "Sales"')).toBe('"Head of Sales"')
    expect(anyOf(['Founder'])).toBe('"Founder"')
    expect(anyOf(['Founder', 'CEO'])).toBe('("Founder" OR "CEO")')
  })

  it('searches a country’s own site where it has one', () => {
    expect(profileSite()).toBe('site:linkedin.com/in')
    expect(profileSite(countrySite('United Kingdom'))).toBe('site:uk.linkedin.com/in')
    expect(countrySite('United States')).toBeNull()
  })
})
