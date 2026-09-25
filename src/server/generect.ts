import crypto from 'crypto'
import { env } from './env'


const GENERECT_BASE = env.generect.baseUrl

function generectHeaders() {
  return {
    'Authorization': `Token ${env.generect.apiKey()}`,
    'Content-Type': 'application/json',
  }
}

// The UI offers "10001+" but Generect's vocabulary spells the top bucket
// "10 000+" and hard-rejects anything else with a 400.
const HEADCOUNT_ALIASES: Record<string, string> = {
  '10001+': '10 000+',
  '10000+': '10 000+',
}

export interface ProspectLead {
  id: string
  firstName: string
  lastName: string
  title: string
  company: string
  location: string
  emailAddresses: { email: string }[]
  phoneNumbers: { number: string }[]
  linkedinUrl?: string
}

export interface ProspectSearchResponse {
  leads: ProspectLead[]
  /** How many leads match in Generect's database, not how many were returned. */
  totalCount: number | null
  amountCharged: number
}

export async function searchProspects(params: {
  title?: string | string[]
  company?: string | string[]
  location?: string | string[]
  leadsLocation?: string | string[]
  companyLocation?: string | string[]
  industry?: string | string[]
  seniority?: string | string[]
  excludedTitles?: string | string[]
  limit?: number
  employeeCount?: string | string[] | number | number[]
  excludeLocations?: string | string[]
  excludeIndustries?: string | string[]
  excludeHeadcounts?: string | string[]
  companyTypes?: string | string[]
  requireWebsite?: boolean
}): Promise<ProspectSearchResponse> {
  const cleanList = (value?: string | string[] | number | number[]) =>
    (value !== undefined && value !== null ? (Array.isArray(value) ? value : [value]) : [])
      .map((t) => String(t).trim())
      .filter(Boolean)

  const body: any = {
    limit_by: params.limit || 20,
  }

  // Previously hardcoded, which silently required every company to have a
  // website. Now opt-in so the caller decides.
  if (params.requireWebsite) {
    body.filter_empty_vars = ['company_website']
  }

  // v1 takes job titles and seniorities as first-class fields, so seniorities
  // no longer get silently dropped when no title is set (as they did on the
  // deprecated by_icp persona tuple).
  const titles = cleanList(params.title)
  if (titles.length > 0) body.job_titles = titles

  const seniorities = cleanList(params.seniority)
  if (seniorities.length > 0) body.seniorities = seniorities

  const excludedTitles = cleanList(params.excludedTitles)
  if (excludedTitles.length > 0) body.exclude_names = excludedTitles

  // v1 still accepts only a single company_name; callers OR multiple companies
  // by issuing one variant search per company.
  const companies = cleanList(params.company)
  if (companies.length > 0) body.company_name = companies[0]

  const locations = [...cleanList(params.location), ...cleanList(params.leadsLocation)]
  if (locations.length > 0) body.locations = locations

  const companyLocations = cleanList(params.companyLocation)
  if (companyLocations.length > 0) body.company_locations = companyLocations

  const industries = cleanList(params.industry)
  if (industries.length > 0) body.company_industries = industries

  const headcounts = cleanList(params.employeeCount).map(c => HEADCOUNT_ALIASES[c] ?? c)
  if (headcounts.length > 0) body.company_headcounts = headcounts

  const excludeLocations = cleanList(params.excludeLocations)
  if (excludeLocations.length > 0) body.exclude_locations = excludeLocations

  const excludeIndustries = cleanList(params.excludeIndustries)
  if (excludeIndustries.length > 0) body.exclude_company_industries = excludeIndustries

  const excludeHeadcounts = cleanList(params.excludeHeadcounts).map(c => HEADCOUNT_ALIASES[c] ?? c)
  if (excludeHeadcounts.length > 0) body.exclude_company_headcounts = excludeHeadcounts

  const companyTypes = cleanList(params.companyTypes)
  if (companyTypes.length > 0) body.company_types = companyTypes

  console.log('[Generect] Searching with body:', JSON.stringify(body, null, 2))

  const res = await fetch(`${GENERECT_BASE}/v1/search/database/leads/`, {
    method: 'POST',
    headers: generectHeaders(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`[Generect] Search failed: ${res.status} - ${err}`)
    throw new Error(friendlySearchError(res.status, err))
  }

  const payload = await res.json()
  const leads = payload?.data?.leads || []
  const totalCount = payload?.data?.results_count ?? null
  const amountCharged = Number(payload?.meta?.amount_charged ?? 0)
  console.log(
    `[Generect] Found ${leads.length} leads ` +
    `(${totalCount ?? '?'} total match, charged $${amountCharged})`
  )

  // The response shape is undocumented and we have no public reference for it,
  // so log the keys of one lead. This is the fastest way for anyone with a
  // working API key to confirm which fields we are failing to map.
  if (leads.length > 0) {
    console.log('[Generect] Lead fields:', Object.keys(leads[0]).join(', '))
  }

  return {
    totalCount,
    amountCharged,
    leads: leads.map((l: any): ProspectLead => ({
      id: l.linkedin_id || l.id || crypto.randomUUID(),
      firstName: l.first_name || '',
      lastName: l.last_name || '',
      title: l.job_title || '',
      company: l.company_name || '',
      // UNVERIFIED key name — `location` is a first-class search filter but the
      // mapper never extracted it, so every consumer saw `undefined`. Check the
      // "Lead fields" log above against a live response and pin this down.
      location: l.location || l.lead_location || l.geo_region || '',
      // v1 search never returns an email; it's revealed on demand via findEmail.
      emailAddresses: [] as { email: string }[],
      phoneNumbers: l.phone ? [{ number: l.phone }] : [],
      linkedinUrl: l.linkedin_url
    })),
  }
}

// Generect rejects values outside its controlled vocabularies with a 400 whose
// `detail` maps each bad field to the offending values. Surface that as
// something a user can act on instead of raw JSON.
function friendlySearchError(status: number, raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    const detail = parsed?.detail

    if (typeof detail === 'string') {
      if (detail.toLowerCase().includes('insufficient funds')) return 'INSUFFICIENT_FUNDS'
      return detail
    }

    if (detail && typeof detail === 'object') {
      const FIELD_LABELS: Record<string, string> = {
        locations: 'Location',
        company_locations: 'Company Location',
        exclude_locations: 'Excluded Location',
        company_headcounts: 'Headcount',
        exclude_company_headcounts: 'Excluded Headcount',
        company_types: 'Company Type',
        company_industries: 'Industry',
        exclude_company_industries: 'Excluded Industry',
        seniorities: 'Seniority',
      }
      const parts = Object.entries(detail).map(([field, value]) => {
        const label = FIELD_LABELS[field] || field
        const values = value && typeof value === 'object' ? Object.keys(value) : [String(value)]
        return `${label}: ${values.map(v => `"${v}"`).join(', ')}`
      })
      if (parts.length > 0) {
        return `Not recognised by Generect — ${parts.join('; ')}. Pick a value from the suggestions.`
      }
    }
  } catch {
    // fall through to the generic message
  }
  return `Generect error ${status}: ${raw}`
}

export async function findEmail(linkedinUrl: string): Promise<string | null> {
  const res = await fetch(`${GENERECT_BASE}/v1/email/find/`, {
    method: 'POST',
    headers: generectHeaders(),
    body: JSON.stringify({ linkedin_url: linkedinUrl }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`[Generect] Email find failed for ${linkedinUrl}: ${res.status} - ${err}`)
    return null
  }

  const data = await res.json()
  return data?.data?.valid_email || null
}

export async function getAccountUsage() {
  const res = await fetch(`${GENERECT_BASE}/auth/users/me/`, {
    headers: { 'Authorization': `Token ${env.generect.apiKey()}` }
  })
  if (!res.ok) {
    const errText = await res.text()
    console.error(`Generect usage fetch failed: ${res.status} - ${errText}`)
    throw new Error('Failed to fetch Generect account info')
  }
  const data = await res.json()

  // `balance_platform` is a USD balance. `max_credits` is a plan-tier number in
  // an unrelated unit — the two must not be compared or subtracted (doing so
  // previously produced a "151 / 100" meter). Report the real dollar balance
  // and the daily search quota, which are the only two figures Generect gives
  // us that actually mean something to the user.
  return {
    balanceUsd: data.balance_platform != null ? parseFloat(data.balance_platform) : 0,
    searchesToday: data.count_searches_completed_today ?? 0,
    searchesDailyLimit: data.max_searches_daily ?? 0,
  }
}
