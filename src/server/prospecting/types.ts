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

/**
 * Signs that a company, or a person there, may be in the market now
 * (signals.ts). `warm`: the workspace's own email, forms or proposals found
 * interest there. `new_in_role`: the person started their job lately.
 * `hiring`, `funding`, `growing`: from the web and LinkedIn's company pages.
 */
export const SIGNAL_KINDS = ['warm', 'new_in_role', 'hiring', 'funding', 'growing'] as const
export type SignalKind = (typeof SIGNAL_KINDS)[number]
/** Kinds about a company, which apply to everyone there. */
export const COMPANY_SIGNAL_KINDS: readonly SignalKind[] = ['warm', 'hiring', 'funding', 'growing']

export interface Signal {
  kind: SignalKind
  /** What a badge says: "Warm · 2 people clicked", "New in role · since Mar 2026". */
  label: string
  /** More, for the badge's tooltip. Counts only, never who. */
  detail?: string
  /** When it happened (a date or a month), where that's known. */
  at?: string | null
  /** Where it was seen: a careers page or an article, or the company's page in the app. */
  url?: string | null
  source: 'workspace' | 'linkedin' | 'web'
}

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
  /** Its signals (signals.ts), where there are any. */
  signals?: Signal[]
  /** `headcount` is the company page's own count, not the bottom of a size range: what growth is measured from. */
  headcountExact?: boolean
}

/** One of the jobs someone holds now: its title and employer (name, company page). */
export interface CurrentJob {
  title: string
  company: string
  companyRef: string | null
  companySlug?: string | null
  /** When they started it, as their profile says: a year ("2026") or a month ("2026-03"), never the day. */
  startedOn?: string | null
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
   * On a profile lookup's answer only (getPerson), for someone who holds
   * several jobs at once: the current jobs after the first, which is the one
   * `title` and `company` describe. A founder often lists their own firm
   * second. refineFromProfile picks between them; a person shown, saved or
   * sent anywhere never carries this.
   */
  otherJobs?: CurrentJob[]
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
  /**
   * After a profile lookup: whether `title` is their job's own title from
   * the profile (true), or still the part of their headline the search
   * matched because the profile gave none (false).
   */
  titleExact?: boolean
  /**
   * The search that showed them (searchLog.ts): a random id, so a Reveal or
   * a save can count its outcome against that search's filters. Says nothing
   * about the person.
   */
  searchId?: string
  /** Their company's domain is already known to take no email. Company data, not personal. */
  noMail?: boolean
  /**
   * Their company's mail server lately wouldn't answer our check (it blocks
   * verification, or answered neither way), so an address there can't be
   * verified until it's tried again, a day on. Company data, not personal.
   */
  noAnswer?: boolean
  /**
   * Their profile names an employer without linking its company page, and no
   * company we know goes by that name alone; or its page lists no website
   * and none could be found. Either way there's no website to find an email
   * on, so none can be found for them.
   */
  noCompany?: boolean
  /**
   * What was known of their mail domain when they were shown (company data):
   * an email format learned there, tested and not accepting every address,
   * known to accept every address, take no email or not answer (`deadEnd`),
   * or not tested yet. Counted against how their lookup ends (searchLog.ts).
   */
  mailCheck?: 'pattern' | 'tested' | 'deadEnd' | 'untested'
  /**
   * Already a contact (`saved`: details and email come from the contact, and
   * the profile isn't looked up again) or revealed before (`revealed`).
   */
  previously?: 'saved' | 'revealed'
  /** Set once the email has been revealed, so saving reuses it. */
  email?: string
  emailStatus?: EmailStatus
  /**
   * Their job and employer came from the host's shared database
   * (sharedPeople.ts) instead of a profile lookup: the handle the host takes
   * to give their verified email. Hosted copies only.
   */
  shared?: string
  /**
   * When they started the job shown, from their profile: a year or a month,
   * never the day. In memory only, like the rest of a search result: never
   * saved with a contact, sent to the host or logged (signals.ts).
   */
  roleStartedOn?: string
  /** Their signals, and their company's (signals.ts), where there are any. */
  signals?: Signal[]
  /**
   * Not one of the titles searched: a related role in the same department,
   * shown after the exact matches when a page would be short (relatedRoles).
   */
  related?: boolean
}

/**
 * People shown on a page of search results, in 25s: the whole page, however
 * many job titles the search has (each title is searched on its own and the
 * page is shared between them).
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
   * Show people who are already contacts, filled in from the contact. Off
   * (the default), they're left out and more people are searched for to fill
   * the page.
   */
  includeContacts?: boolean
  /**
   * Only people with at least one of these signals (signals.ts). Kinds about
   * a company (warm, hiring, funding, growing) choose the companies first;
   * new in role is judged from each person's profile.
   */
  signals?: SignalKind[]
  /**
   * LinkedIn company ids to search inside (up to 20), for a search that
   * found companies of the chosen size first. Set by search.ts, not the page.
   */
  companyRefs?: string[]
  /** Those companies' names, by id, so a headline naming one ("Founder, Acme") says where someone works. */
  companyNames?: Record<string, string>
  /** Those companies all have 50 staff or fewer, so leaders only bigger ones have aren't searched for. Set by search.ts. */
  smallCompanies?: boolean
  /**
   * When too few people have the titles searched, fill the page with people
   * in related roles in the same department (a Sales Executive for "Sales
   * Manager"), after them and marked. On unless false.
   */
  relatedRoles?: boolean
  /**
   * Start at the top of the results. Otherwise a new search (no cursor) with
   * the same filters as an earlier one carries on from where that one stopped.
   */
  fromStart?: boolean
  /**
   * Results per page. Asked of search.ts: people on the page in all, in
   * PAGE_SIZES. Asked of a source: per job title's request (1-50), each
   * costing the same whatever its size.
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
  /** Paid search requests the page took; people held from an earlier request (searchPool.ts) cost none. Unset means one. */
  requests?: number
  /**
   * How many hits it had before its own filtering, and of those, how many
   * were left out for the title (headline) and for seniority or country: for
   * the search funnel log.
   */
  /** Where a page's people went: `related` of them have a related role, not a title searched (relatedRoles). */
  funnel?: {
    hits: number
    offTitle: number
    filteredOut: number
    related?: number
    /** People across a page's requests counted once each: everyone, and those without a title searched. */
    uniqueHits?: number
    uniqueOffTitle?: number
    /** Paid requests that returned nobody, and multi-word titles tried the other way (socialfetch.ts titleJoiner). */
    emptyRequests?: number
    joinerRetries?: number
    /** By the place of each title searched: people with a title searched that only that title's request found. */
    onlyByTitle?: number[]
  }
}

export interface CompanySource {
  searchCompanies(filters: CompanyFilters): Promise<Page<CompanyResult>>
  /** `slug` (the LinkedIn company page name) allows a cheaper lookup when known. Throws CompanyUnconfirmed when it couldn't be read. */
  /** `pageOnly`: just the company page (1 credit), never the dearer organization lookup; for a page name that's a guess. */
  getCompany(ref: string, slug?: string | null, opts?: { pageOnly?: boolean }): Promise<CompanyResult | null>
}

export interface PeopleSource {
  /** `company` null searches across all companies. */
  searchPeople(company: CompanyRef | null, filters: PeopleFilters): Promise<Page<PersonResult>>
  /** Null when there's no such profile; throws ProfileUnconfirmed when it couldn't be read. */
  getPerson(profileRef: string): Promise<PersonResult | null>
}

/**
 * A profile lookup that learned nothing: the profile may well be there, but
 * it couldn't be read. A hosted copy's host can answer this way when it reads
 * LinkedIn's public pages, where some people hide their profiles from anyone
 * not signed in. Nothing is charged, and asking again later may work.
 */
export class ProfileUnconfirmed extends Error {
  constructor() {
    super("The profile couldn't be confirmed.")
    this.name = 'ProfileUnconfirmed'
  }
}

/** The same for a company lookup: nothing learned, so nothing is remembered about the company. */
export class CompanyUnconfirmed extends Error {
  constructor() {
    super("The company couldn't be confirmed.")
    this.name = 'CompanyUnconfirmed'
  }
}

/** Outcome of email finding for one person, before anything is stored. */
export type EmailStatus =
  | 'verified' // verification server's `safe` on a domain that is not catch-all
  | 'format_confirmed' // domain accepts everything, but its format is well established (FORMAT_CONFIRMED)
  | 'catch_all_likely' // domain accepts everything; best-ranked guess
  | 'risky' // verification server's `risky` and nothing better found
  | 'unverified' // no verification server, or every check came back `unknown`
  | 'not_found' // every candidate was rejected, or the domain takes no mail

/**
 * A prospected contact whose address the mail server never confirmed:
 * `format_confirmed`, `catch_all_likely`, `risky` or `unverified` (or none
 * recorded). Contacts not from prospecting are the user's own.
 */
export function isUnconfirmedGuess(contact: { source?: string; email_status?: EmailStatus }): boolean {
  return Boolean(contact.source) && contact.email_status !== 'verified'
}

/**
 * Whether an address found with `status` is handed over (revealed or saved).
 * Verified always is; with verified-only off, any guess is; with it on, a
 * `format_confirmed` guess only when the user allowed those
 * (Settings → Prospect search).
 */
export function handsOver(status: EmailStatus, policy: { verifiedOnly?: boolean; allowFormatConfirmed?: boolean }): boolean {
  if (status === 'verified' || !(policy.verifiedOnly ?? true)) return true
  return status === 'format_confirmed' && Boolean(policy.allowFormatConfirmed)
}

/**
 * How one email lookup ended: `verified`, or why no address was confirmed.
 * Counted per month (usage.ts) for the hit rate and its failure reasons.
 */
export const LOOKUP_OUTCOMES = [
  'verified',
  'formatConfirmed', // accepts every address, but the company's format is well established
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
