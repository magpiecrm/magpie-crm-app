// Orchestration layer over the low-level Generect client.
//
// Generect's search endpoint has two hard limits that force a single logical
// search to become several HTTP calls: it accepts only one `company_name` per
// request, and a multi-bucket `company_headcounts` array returns fewer (and
// non-deterministic) results than the largest bucket queried alone. Personas
// add a third axis, since each criteria category is OR'd rather than AND'd.
//
// Every caller must go through here rather than calling `searchProspects`
// directly, otherwise those workarounds — plus dedupe, the variant cap and the
// email-cache backfill — are silently skipped.

import type { Persona } from '../features/prospects/types'
import type { ProspectLead } from './generect'

export interface ProspectSearchParams {
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
  personas?: string[]
  excludeLocations?: string | string[]
  excludeIndustries?: string | string[]
  excludeHeadcounts?: string | string[]
  companyTypes?: string | string[]
  requireWebsite?: boolean
}

// Each variant is a separately billed request. Fanning out over personas ×
// companies × headcount buckets multiplies fast (2 personas, 3 companies and 4
// buckets is 120 requests from one button press), so the fan-out is capped and
// the truncation is reported rather than silently applied.
export const MAX_VARIANTS = 12

const toList = (value?: string | string[] | number | number[]): string[] =>
  (value !== undefined && value !== null ? (Array.isArray(value) ? value : [value]) : [])
    .map((v) => String(v).trim())
    .filter(Boolean)

/**
 * Expands one set of user-facing filters into the list of Generect requests
 * needed to answer it. Exported for testing and so callers can preview cost.
 */
export function buildSearchVariants(
  params: ProspectSearchParams,
  personas: Persona[],
): { variants: ProspectSearchParams[]; truncated: number } {
  const baseExcludedTitles = toList(params.excludedTitles)

  // Manually-entered filters (not from a persona) still apply as a fixed AND
  // base on every variant below.
  const baseFilters: ProspectSearchParams = { ...params }
  delete baseFilters.personas

  let variants: ProspectSearchParams[] = []

  const selectedPersonas = personas.filter((p) => params.personas?.includes(p.name))

  if (selectedPersonas.length > 0) {
    const baseHasTitle = toList(baseFilters.title).length > 0

    for (const p of selectedPersonas) {
      const excludedTitles = [...baseExcludedTitles, ...(p.criteria.excludedTitles ?? [])]
      const categories: Array<Partial<ProspectSearchParams>> = []

      if (p.criteria.title?.length) categories.push({ title: p.criteria.title })
      if (p.criteria.industry?.length) categories.push({ industry: p.criteria.industry })
      if (p.criteria.location?.length) categories.push({ location: p.criteria.location })
      // Generect requires a non-empty title list alongside seniority, so only
      // OR seniority in on its own when a title exists to pair it with.
      if (p.criteria.seniority?.length && (p.criteria.title?.length || baseHasTitle)) {
        categories.push({
          seniority: p.criteria.seniority,
          title: p.criteria.title?.length ? p.criteria.title : baseFilters.title,
        })
      }
      if (p.criteria.employeeCount) categories.push({ employeeCount: p.criteria.employeeCount })
      // `keywords` is deliberately not searched: Generect's database mode
      // rejects it outright ("use realtime endpoint"). It stays on the persona
      // purely as messaging context.

      for (const category of categories) {
        variants.push({ ...baseFilters, excludedTitles, ...category })
      }
    }
  }

  if (variants.length === 0) {
    variants = [baseFilters]
  }

  const companyList = toList(baseFilters.company)
  if (companyList.length > 1) {
    variants = variants.flatMap((v) => companyList.map((company) => ({ ...v, company })))
  }

  // Split multi-bucket headcount into one request per bucket — see the module
  // comment. Applied per variant so a persona's own headcount survives.
  variants = variants.flatMap((v) => {
    const buckets = toList(v.employeeCount)
    return buckets.length > 1 ? buckets.map((employeeCount) => ({ ...v, employeeCount })) : [v]
  })

  // Applying a persona from the Personas page copies its criteria into the
  // flat filters *and* selects the persona, which made every category variant
  // byte-identical to the base query — N identical paid requests returning one
  // query's worth of leads. Collapse duplicates before spending anything.
  const seen = new Set<string>()
  const unique: ProspectSearchParams[] = []
  for (const v of variants) {
    const key = JSON.stringify(
      Object.entries(v)
        .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ''))
        .map(([k, value]) => [k, Array.isArray(value) ? [...value].map(String).sort() : value])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    )
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(v)
  }

  const truncated = Math.max(0, unique.length - MAX_VARIANTS)
  return { variants: unique.slice(0, MAX_VARIANTS), truncated }
}

export async function runProspectSearch(params: ProspectSearchParams) {
  const Generect = await import('./generect')
  const { db } = await import('./db')

  const personas = params.personas?.length ? (db.getPersonas() as Persona[]) : []
  const { variants, truncated } = buildSearchVariants(params, personas)

  const warnings: string[] = []
  if (truncated > 0) {
    warnings.push(
      `This combination of filters expands to ${variants.length + truncated} separate Generect searches. ` +
        `Only the first ${MAX_VARIANTS} were run — narrow the companies, headcount buckets or personas for complete results.`,
    )
  }

  console.log(`[Search] Using Generect, ${variants.length} OR'd variant search(es)...`)

  // One bad value in one variant used to reject the whole search via
  // Promise.all, discarding results the account had already been charged for.
  const settled = await Promise.allSettled(variants.map((v) => Generect.searchProspects(v)))

  const failures = settled.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
  const succeeded = settled.filter(
    (r) => r.status === 'fulfilled',
  ) as PromiseFulfilledResult<Awaited<ReturnType<typeof Generect.searchProspects>>>[]

  // Nothing came back at all — surface the real error instead of an empty list.
  if (succeeded.length === 0) {
    throw failures[0]?.reason ?? new Error('Prospect search returned no results')
  }

  if (failures.length > 0) {
    // INSUFFICIENT_FUNDS is a sentinel the UI renders as a dedicated empty
    // state; in a partial failure it only ever reaches the warning banner, so
    // it needs to read as a sentence.
    const messages = [
      ...new Set(
        failures.map((f) => {
          const message = String(f.reason?.message ?? f.reason)
          return message === 'INSUFFICIENT_FUNDS' ? 'Generect balance exhausted' : message
        }),
      ),
    ]
    warnings.push(
      `${failures.length} of ${variants.length} searches failed and their results are missing: ${messages.join('; ')}`,
    )
  }

  const seen = new Set<string>()
  const contacts: ProspectLead[] = []
  for (const { value } of succeeded) {
    for (const contact of value.leads) {
      const key = contact.linkedinUrl || contact.id
      if (seen.has(key)) continue
      seen.add(key)
      contacts.push(contact)
    }
  }

  const limited = params.limit ? contacts.slice(0, params.limit) : contacts

  // Generect's search doesn't return emails and each lookup costs credits, so
  // emails are revealed on demand (see revealEmailFn). Any lead we've already
  // paid to look up is filled in for free from the cache.
  for (const contact of limited) {
    if (contact.emailAddresses.length > 0 || !contact.linkedinUrl) continue
    const cached = db.getCachedEmailLookup(contact.linkedinUrl)
    if (cached?.email) contact.emailAddresses = [{ email: cached.email }]
  }

  // `results_count` is how many leads match in Generect's database, which is
  // almost always far more than `limit_by` returns. Reporting the largest
  // variant's count (rather than the sum) avoids double-counting the overlap
  // between OR'd variants — it's a floor on the true union.
  const totalMatches = succeeded.reduce((max, r) => Math.max(max, r.value.totalCount ?? 0), 0)
  const amountCharged = succeeded.reduce((sum, r) => sum + (r.value.amountCharged ?? 0), 0)

  return {
    contacts: limited,
    totalMatches,
    searchesRun: variants.length,
    amountCharged,
    warnings,
  }
}
