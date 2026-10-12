import { describe, expect, it } from 'vitest'
import { titleAlone } from './refine'

describe('titleAlone', () => {
  it("stops a title where the employer's name starts", () => {
    const cases: Array<[title: string, company: string, alone: string]> = [
      ['Owner, Eberly & Collard Public Relations', 'Eberly & Collard Public Relations', 'Owner'],
      ['President/CEO, Eberly & Collard Public Relations - Dynamic & Strategic Integrated Marketing', 'Eberly & Collard Public Relations', 'President/CEO'],
      ['CEO 2112 Media: Chairman of the Board, Financial Communications Society', '2112 Media', 'CEO'],
      ['Founder Teak Media + Communication', 'Teak Media Communications', 'Founder'],
      ['Owner / COO of Hometown Digital Marketing, Cookeville Now', 'Hometown Digital Marketing Agency', 'Owner / COO'],
      ['Owner and Director, MKM Marketing Communications Ltd', 'MKM Marketing Communications', 'Owner and Director'],
      ['Founder – The Marketing Café', 'The Marketing Cafe', 'Founder'],
      ['Founder of Sochelle', 'Sochelle', 'Founder'],
      ['President, MediaFuel', 'MediaFuel', 'President'],
      ['CEO, FCS', 'Financial Communications Society', 'CEO'],
      ['CEO @ Acme', 'Acme', 'CEO'],
      ['Owner, Hackin', 'Hackin Ltd', 'Owner'],
      ['Owner, Digital Marketing Agency', 'Digital Marketing Agency', 'Owner'],
      ['Founder at Clean', 'Clean', 'Founder'],
      ['As CEO', 'Hummingbird Creative Group', 'CEO'],
    ]
    for (const [title, company, alone] of cases) expect(titleAlone(title, company), title).toBe(alone)
  })

  it('leaves a title alone when the name in it is part of the job, or there is nothing else', () => {
    const cases: Array<[title: string, company: string]> = [
      ['Managing Director', 'Flashbulb'],
      ['Senior Curator', 'Curator'],
      ['Head of Sales', 'Sales Ltd'],
      ['Director of Marketing and Communications', 'Marketing Works'],
      ['Chief Executive Officer', 'CEO Coaching International'],
      ['Director of Digital Marketing', 'Digital Marketing Agency'],
      ['Head of Social Media', 'Social Media'],
      ['Head of Sales', 'Sales'],
      ['Social Media Manager', 'Social Media Ltd'],
      ['Assistant Manager', 'As You Like It'],
      ['Acme', 'Acme'],
      ['Founder', ''],
      // Initials only when they're written as initials.
      ['Head of fcs', 'Financial Communications Society'],
    ]
    for (const [title, company] of cases) expect(titleAlone(title, company), title).toBe(title)
  })
})
