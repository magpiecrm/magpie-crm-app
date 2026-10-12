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
      ['Managing Director Colourmedia', 'Colourmedia', 'Managing Director'],
      // Another organisation's name, a slogan or a bullet isn't part of the job either.
      ['Owner of Simplicity Design and Marketing', 'Chatter Creative', 'Owner'],
      ['Founder, MissionFound', 'Macon Raine', 'Founder'],
      ['◾️Creative Visionary & Co-founder', 'StrixMedia', 'Creative Visionary & Co-founder'],
      ['Founder - Helping brands grow', 'Acme', 'Founder'],
      ['CEO & Founder | Speaker | Helping agencies scale', 'Acme', 'CEO & Founder | Speaker'],
      ['Chief Executive Officer of Bright Ideas, a creative shop', 'Acme', 'Chief Executive Officer'],
      ['President (Retired Navy)', 'Acme', 'President'],
      ['Managing Director of Creator Operations', 'Creator Authority', 'Managing Director'],
      ['Founder & Managing Director of Mall Media & More', 'Gb Outdoor Ltd', 'Founder & Managing Director'],
      // A slogan first, the job after it.
      ['“Aight, man, holla then”//Founder of Disruptur', 'Disruptur', 'Founder'],
      ['Marketing Agency for Lead Generation I Co-Owner & Director I Catalyst Marketing Agency', 'Catalyst Marketing Agency', 'Co-Owner & Director'],
      ['Boost Business Growth Founder 🌱 B2B Marketing, B2B Lead Generation 🌱 Nature Lover', 'Boost Business Growth', 'Founder'],
      ['MD of 🏆 Award Winning Marketing Agency 🏆 Ruddle Digital', 'Ruddle Digital', 'MD'],
      ['President and CEO / First Touch Payment Solutions, LLC / Software Earnings, Inc.', 'Software Earnings, Inc.', 'President and CEO'],
      ['Chief Executive Officer a Signify Research Ltd', 'Signify Research Ltd', 'Chief Executive Officer'],
      ['Chief Digital Officer (CDO)', 'CraneNetwork.com', 'Chief Digital Officer'],
      ['💡 CEO & Co-founder', 'Sapio Research', 'CEO & Co-founder'],
    ]
    for (const [title, company, alone] of cases) expect(titleAlone(title, company), title).toBe(alone)
  })

  it('leaves a title alone when the name in it is part of the job, or there is nothing else', () => {
    const cases: Array<[title: string, company: string]> = [
      ['Managing Director', 'Flashbulb'],
      ['Founder, CEO', 'Advirtis'],
      ['SVP, Strategic Account Sales', 'Radix'],
      ['Vice President, Operations & Strategy', 'Zapata Quantum'],
      ['Co-Founder | VP of Outreach + Marketing', 'Bent Paddle Brewing Company'],
      ['Managing Director of Operations', 'Acme'],
      ['Accounts Payable and Payroll Administrator', 'VISION Consulting'],
      ['I help better-for-you CPG brands maximize profitability on Amazon', 'TripleLine'],
      ['Founder/COO/Producer', 'Execute'],
      ['President & Chief Strategy Officer', 'Marketing Options'],
      ['Owner and Director', 'MKM'],
      ['VP, Marketing', 'Acme'],
      ['Director - Sales and Operations', 'Acme'],
      ['Vice President of Business Development', 'Acme'],
      ['Head of Sales', 'Acme'],
      ['Chairman of the Board', 'Acme'],
      ['Chief of Staff', 'Acme'],
      ['Co-Founder and Studio Director', 'LSB Studios'],
      ['Senior Business Analyst', 'Barclays'],
      ['Agency Owner', 'LouMac Strategies llc'],
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
