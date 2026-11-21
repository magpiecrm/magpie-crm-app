// The made-up world the stand-in host serves: companies at `.test` domains
// (which can never be real) and the people who work there. The same every run,
// so a journey can name who it expects to find.

export interface FakeCompany {
  id: string
  name: string
  slug: string
  domain: string
  industry: string
  headcount: number
  country: string
  /** How its addresses are made, for the verification stand-in. */
  format: 'first.last' | 'first' | 'flast' | 'catch-all' | 'no-mx'
  hiring?: boolean
  funding?: string
}

export interface FakePerson {
  slug: string
  first: string
  last: string
  title: string
  companyId: string
  country: string
  /** Started this job (for "new in role"). */
  since: { year: number; month?: number }
}

export const COMPANIES: FakeCompany[] = [
  { id: '9100001', name: 'Copperwick Analytics', slug: 'copperwick-analytics', domain: 'copperwick.test', industry: 'Software Development', headcount: 42, country: 'GB', format: 'first.last', hiring: true },
  { id: '9100002', name: 'Bramblefield Logistics', slug: 'bramblefield', domain: 'bramblefield.test', industry: 'Transportation, Logistics, Supply Chain and Storage', headcount: 310, country: 'GB', format: 'flast', funding: 'Series B' },
  { id: '9100003', name: 'Lanternfish Health', slug: 'lanternfish-health', domain: 'lanternfish.test', industry: 'Hospitals and Health Care', headcount: 18, country: 'US', format: 'first' },
  { id: '9100004', name: 'Quillmoor Studio', slug: 'quillmoor', domain: 'quillmoor.test', industry: 'Design Services', headcount: 6, country: 'GB', format: 'catch-all' },
  { id: '9100005', name: 'Saltmarsh Robotics', slug: 'saltmarsh-robotics', domain: 'saltmarsh.test', industry: 'Industrial Machinery Manufacturing', headcount: 1200, country: 'DE', format: 'first.last', hiring: true, funding: 'Series C' },
  { id: '9100006', name: 'Thistledown Finance', slug: 'thistledown-finance', domain: 'thistledown.test', industry: 'Financial Services', headcount: 85, country: 'US', format: 'no-mx' },
]

const FIRST = ['Ada', 'Bram', 'Cora', 'Dev', 'Elin', 'Farah', 'Gus', 'Hana', 'Ivo', 'Jude', 'Kit', 'Lior', 'Mina', 'Nico', 'Oona', 'Pip', 'Quin', 'Rhea', 'Sol', 'Tam']
const LAST = ['Ashby', 'Brook', 'Calder', 'Dunmore', 'Ellery', 'Fennick', 'Garside', 'Hollins', 'Ingram', 'Jessop', 'Kettle', 'Lumley', 'Marlow', 'Nesbit', 'Orme', 'Pryor', 'Quarrie', 'Royle', 'Sutcliffe', 'Tindall']
const TITLES = ['Head of Marketing', 'Marketing Manager', 'VP Sales', 'Sales Director', 'Founder', 'CEO', 'Chief Technology Officer', 'Operations Manager', 'Growth Lead', 'Head of People']

/** Six people at each company, the same every run. */
export const PEOPLE: FakePerson[] = COMPANIES.flatMap((c, ci) =>
  Array.from({ length: 6 }, (_, i) => {
    const n = ci * 6 + i
    const first = FIRST[n % FIRST.length]
    const last = LAST[(n * 7 + ci) % LAST.length]
    return {
      slug: `${first}-${last}-${c.slug}`.toLowerCase(),
      first,
      last,
      title: TITLES[(n * 3 + i) % TITLES.length],
      companyId: c.id,
      country: c.country,
      since: i === 0 ? { year: new Date().getFullYear(), month: new Date().getMonth() + 1 } : { year: 2019 + (n % 5) },
    }
  }),
)

export const companyById = (id: string) => COMPANIES.find((c) => c.id === id)
export const companyByDomain = (domain: string) => COMPANIES.find((c) => c.domain === domain.toLowerCase())
export const companyBySlug = (slug: string) => COMPANIES.find((c) => c.slug === slug.toLowerCase() || c.id === slug)
export const personBySlug = (slug: string) => PEOPLE.find((p) => p.slug === slug.toLowerCase())
export const profileUrl = (p: FakePerson) => `https://www.linkedin.com/in/${p.slug}`

/** The address the made-up company really uses for this person, or null where none can be known. */
export function realAddress(p: FakePerson): string | null {
  const c = companyById(p.companyId)!
  const f = p.first.toLowerCase()
  const l = p.last.toLowerCase()
  switch (c.format) {
    case 'first.last':
      return `${f}.${l}@${c.domain}`
    case 'first':
      return `${f}@${c.domain}`
    case 'flast':
      return `${f[0]}${l}@${c.domain}`
    default:
      return null
  }
}

/** What a verification of this address says, as the stand-in answers it. */
export function verdict(address: string): 'safe' | 'invalid' | 'risky' | 'unknown' {
  const [, domain] = address.toLowerCase().split('@')
  const c = companyByDomain(domain ?? '')
  if (!c) return domain?.endsWith('.test') ? 'invalid' : 'unknown'
  if (c.format === 'catch-all') return 'risky'
  if (c.format === 'no-mx') return 'invalid'
  return PEOPLE.some((p) => p.companyId === c.id && realAddress(p) === address.toLowerCase()) ? 'safe' : 'invalid'
}
