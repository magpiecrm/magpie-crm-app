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
  /**
   * Its mail domain is already known to accept every address, so no email
   * there can be verified. From the domain cache; no check is run for it.
   */
  catchAll?: boolean
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
  /** LinkedIn company page name (e.g. `acme-ltd`): company data, for the cheaper company lookup. */
  companySlug?: string | null
  companyDomain: string | null
  country: string | null
  source: SourceId
  /**
   * Their profile has already been looked up (3 credits), whether or not it
   * listed a current job. Saving won't pay for the same lookup again.
   */
  profileChecked?: boolean
  /**
   * Their company is already known to accept every address, so no email
   * there can be verified. Company data (from the domain cache), not personal.
   */
  catchAll?: boolean
  /** Their company's domain is already known to take no email. Company data, not personal. */
  noMail?: boolean
  /**
   * Already a contact (`saved`: details and email come from the contact, and
   * the profile isn't looked up again) or revealed before (`revealed`).
   */
  previously?: 'saved' | 'revealed'
  /** Set once the email has been revealed, so saving reuses it. */
  email?: string
  emailStatus?: EmailStatus
}

/**
 * People search results per page (per job title), in 25s. Full pages share
 * each 3-credit search among the most people; SocialFetch returns up to 50 a
 * request, so 75 and 100 take two.
 */
export const PAGE_SIZES = [25, 50, 75, 100] as const

/** The nearest page size at or above `count`. */
export const pageSizeFor = (count?: number | null) =>
  PAGE_SIZES.find((n) => n >= (count ?? PAGE_SIZES[0])) ?? PAGE_SIZES[PAGE_SIZES.length - 1]

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
  /** Industry names from INDUSTRIES; filtered by the search itself. */
  industries?: string[]
  /**
   * Company sizes. The people search can't filter by size, so each person's
   * employer is looked up (1 credit per company, then cached for everyone)
   * and people at other sizes are left out.
   */
  companySizes?: HeadcountBucket[]
  /**
   * Results per page. Asked of search.ts: per job title, in PAGE_SIZES. Asked
   * of a source: per request (1-50), each costing the same whatever its size.
   */
  count?: number
  cursor?: string
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
  /** Provider's own estimate; not a guarantee of retrievable matches. */
  reportedTotal: number | null
  /** Non-fatal problems the user should see alongside the results. */
  warnings: string[]
  /**
   * How the page was put together: results left out and why, extra searches
   * run to fill it. Shown after the warnings, except in a copy whose data is
   * run by its host, where they're the host's business.
   */
  details?: string[]
}

export interface CompanySource {
  searchCompanies(filters: CompanyFilters): Promise<Page<CompanyResult>>
  /** `slug` (the LinkedIn company page name) allows a cheaper lookup when known. */
  getCompany(ref: string, slug?: string | null): Promise<CompanyResult | null>
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

/**
 * How one email lookup ended: `verified`, or why no address was confirmed.
 * Counted per month (usage.ts) for the hit rate and its failure reasons.
 */
export const LOOKUP_OUTCOMES = [
  'verified',
  'catchAll', // the company's mail server accepts every address
  'rejected', // every likely format was rejected
  'risky', // only risky answers
  'greylisted', // the mail server asked us to try again later
  'noAnswer', // the mail server couldn't be checked (timeouts, unknown answers)
  'refused', // the mail server refuses connections from the verification IPs
  'blocked', // the verification IP or sender domain is blocked or blocklisted
  'noMail', // the company's domain doesn't receive email
  'noDomain', // the company's website, or where they work, isn't known
  'hiddenSurname', // LinkedIn hides their surname
  'badName', // their name can't be turned into an address
  'limit', // a verification limit (daily cap, pause, per-minute) stopped the checks
  'unchecked', // email verification is off
] as const
export type LookupOutcome = (typeof LOOKUP_OUTCOMES)[number]

export type NoticeStatus = 'pending' | 'delivered_first_email' | 'delivered_fallback'
