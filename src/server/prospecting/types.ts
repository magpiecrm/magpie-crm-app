// Internal models for prospecting. Provider connectors map their responses into
// these shapes and nothing else crosses the boundary, so swapping SocialFetch
// for another provider means writing one new file that implements
// `CompanySource` and `PeopleSource`.
//
// Data minimisation is enforced by these types: a person carries only name,
// title, seniority, company, company domain, country and profile URL. Photos,
// posts, education, follower counts and detailed location never get past the
// connector.

type SourceId = 'socialfetch'

export const SENIORITY_LEVELS = [
  'owner',
  'founder',
  'c_suite',
  'partner',
  'vp',
  'head',
  'director',
  'manager',
  'senior',
  'entry',
  'intern',
] as const
export type Seniority = (typeof SENIORITY_LEVELS)[number]

export const HEADCOUNT_BUCKETS = [
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1000',
  '1001-5000',
  '5001-10000',
  '10001+',
] as const
export type HeadcountBucket = (typeof HEADCOUNT_BUCKETS)[number]

export interface CompanyResult {
  /** Provider's stable identifier for the company (numeric LinkedIn org id when known). */
  ref: string
  name: string
  /** Bare registrable host, e.g. `acme.com`. Null means unknown — the user can supply it. */
  domain: string | null
  industry: string | null
  headcount: number | null
  companyType: string | null
  country: string | null
  linkedinUrl: string | null
  source: SourceId
}

export interface PersonResult {
  profileUrl: string
  firstName: string
  lastName: string
  title: string
  /** Derived from the title; the provider has no seniority field. */
  seniority: Seniority | null
  company: string
  companyRef: string | null
  companyDomain: string | null
  country: string | null
  source: SourceId
}

export interface CompanyRef {
  ref: string
  name: string
}

export interface CompanyFilters {
  keyword: string
  industry?: string
  headcount?: HeadcountBucket[]
  country?: string
  cursor?: string
}

export interface PeopleFilters {
  titles?: string[]
  seniorities?: Seniority[]
  country?: string
  keyword?: string
  cursor?: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
  /** Provider's own estimate; not a guarantee of retrievable matches. */
  reportedTotal: number | null
  /** Non-fatal problems the user should see alongside the results. */
  warnings: string[]
}

export interface CompanySource {
  searchCompanies(filters: CompanyFilters): Promise<Page<CompanyResult>>
  getCompany(ref: string): Promise<CompanyResult | null>
}

export interface PeopleSource {
  /** `company` null searches across all companies. */
  searchPeople(company: CompanyRef | null, filters: PeopleFilters): Promise<Page<PersonResult>>
  getPerson(profileRef: string): Promise<PersonResult | null>
}

/** Outcome of email finding for one person, before anything is stored. */
export type EmailStatus =
  | 'verified' // Reacher `safe` on a domain that is not catch-all
  | 'catch_all_likely' // domain accepts everything; best-ranked guess
  | 'risky' // Reacher `risky` and nothing better found
  | 'unverified' // Reacher not configured, or every check came back `unknown`
  | 'not_found' // every candidate was rejected, or the domain takes no mail

export type NoticeStatus = 'pending' | 'delivered_first_email' | 'delivered_fallback'
