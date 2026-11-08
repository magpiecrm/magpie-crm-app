import { HEADCOUNT_BUCKETS, SENIORITY_LEVELS, type HeadcountBucket, type Seniority } from '../../server/prospecting/types'
import { parseSeniorityLabel } from '../../server/prospecting/seniority'
import { INDUSTRIES } from './constants/industries'

/** Who a persona is, as people search's own filters (ProspectSearch's people form), so applying one is just these. */
export interface PersonaCriteria {
  titles: string[]
  seniorities: Seniority[]
  /** Exact values from INDUSTRIES: search matches nothing else. */
  industries: string[]
  companySizes: HeadcountBucket[]
  country: string
  keyword: string
}

export interface Persona {
  id: string
  name: string
  description: string
  criteria: PersonaCriteria
  painPoints: string
  valueProp: string
  created_at: string
  updated_at: string
}

export const DEFAULT_PERSONA_CRITERIA: PersonaCriteria = {
  titles: [],
  seniorities: [],
  industries: [],
  companySizes: [],
  country: '',
  keyword: '',
}

/** Criteria as personas kept them before they matched search's filters. */
interface LegacyCriteria {
  title?: unknown
  seniority?: unknown
  industry?: unknown
  location?: unknown
  employeeCount?: unknown
  keywords?: unknown
}

const KNOWN_INDUSTRIES = new Set<string>(INDUSTRIES)

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean))] : []

const bounds = (text: string): [number, number] | null => {
  const n = text.replace(/[,\s]/g, '').match(/^(\d+)(?:[-–](\d+)|(\+))?$/)
  if (!n) return null
  const lo = Number(n[1])
  return [lo, n[2] ? Number(n[2]) : n[3] ? Number.POSITIVE_INFINITY : lo]
}

/** The size buckets a written range overlaps: "51-200" is one, "100-1,000" three, "5000+" the top three. */
export function bucketsForRange(text: string): HeadcountBucket[] {
  const range = bounds(text)
  if (!range) return []
  return HEADCOUNT_BUCKETS.filter((b) => {
    const [lo, hi] = bounds(b)!
    return lo <= range[1] && hi >= range[0]
  })
}

/**
 * The full criteria shape, from a record of either kind. Older records kept
 * titles, seniority labels, free-text industries, locations, an employee count
 * and excluded titles; search can't use free text, regions or exclusions, so
 * those go: industries off the list, all but the first location's country and
 * the first keyword, and the excluded titles.
 */
export function normalizePersonaCriteria(raw: unknown): PersonaCriteria {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PersonaCriteria, unknown>> & LegacyCriteria
  const seniorities = strings(r.seniorities ?? r.seniority)
    .map((s) => ((SENIORITY_LEVELS as readonly string[]).includes(s) ? (s as Seniority) : parseSeniorityLabel(s)))
    .filter((s): s is Seniority => s !== null)
  const sizes = Array.isArray(r.companySizes)
    ? HEADCOUNT_BUCKETS.filter((b) => (r.companySizes as unknown[]).includes(b))
    : bucketsForRange(typeof r.employeeCount === 'string' ? r.employeeCount : '')
  // Locations were "Region, Country" or a country.
  const country = typeof r.country === 'string' ? r.country.trim() : (strings(r.location)[0]?.split(',').pop()?.trim() ?? '')
  return {
    titles: strings(r.titles ?? r.title),
    seniorities: [...new Set(seniorities)],
    industries: strings(r.industries ?? r.industry).filter((i) => KNOWN_INDUSTRIES.has(i)),
    companySizes: sizes,
    country,
    keyword: typeof r.keyword === 'string' ? r.keyword.trim() : (strings(r.keywords)[0] ?? ''),
  }
}
