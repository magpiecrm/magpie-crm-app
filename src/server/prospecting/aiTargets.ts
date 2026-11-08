// Who to prospect, as the AI works it out from a website: the companies that
// buy first (industries, sizes, a country, maybe a keyword), then the people
// there who decide. Persona drafts (personaDraft.ts) and a suggested search
// (searchSuggest.ts) both ask for this. The answer's fields come in that
// order, so the AI settles the companies before it picks job titles: left to
// itself it reasoned about titles and left the company filters empty.

import { z } from 'zod'
import { normalizePersonaCriteria, type PersonaCriteria } from '../../features/prospects/types'
import { INDUSTRIES } from '../../features/prospects/constants/industries'
import { SUPPORTED_COUNTRIES } from './geo'
import { HEADCOUNT_BUCKETS, SENIORITY_LEVELS } from './types'

export const TARGET_RULES = `Work out who buys in two steps, companies first.

1. The companies. From the website's customers, case studies, testimonials, pricing and wording, decide which kinds of company buy this, and why. Where it names none, reason from what it sells: which companies have the problem it solves and can pay its prices. Put who they are in "companies", then set:
  - industries: 1 to 3 from the allowed values, the industries on those companies' LinkedIn pages. Even a product any business could use sells best somewhere: pick where.
  - companySizes: 1 to 3 adjacent staff-count bands those companies fall in, judged from pricing (per seat, plan limits, a free tier), case studies, and wording like "for small teams" or "enterprise".
  - country: the one country it mainly sells in, from the allowed values, judged from its address, currency, phone numbers, spelling, customers and domain. Empty only if nothing points to one.
  - keyword: usually empty. Search looks for companies in each industry by it, so it narrows them: use one only when the industries are broader than the companies you mean, as a word those companies use about themselves, e.g. "freight forwarding" or "dental practice". Never a word like "B2B", "business" or "services".

2. The people at those companies who decide to buy it, or feel the problem it solves. Put who they are in "people", then set:
  - titles: 1 to 5 job titles as people write them on LinkedIn, fitting the companies' size: at 1-10 or 11-50 staff the Founder, Owner or Managing Director usually decides; at larger ones, the head of the team that would use it, e.g. "Head of Marketing" or "Operations Manager". "Sales leaders", "Marketing leaders", "Operations leaders", "Finance leaders" and "Engineering leaders" each find that department's Heads, VPs and Directors.
  - seniorities: only where it narrows the titles usefully; usually empty.

"companies" and "people" describe the buyers, not how you found them: one short sentence each, never about the website, its pages or what they leave out.`

/** Words that describe no company in particular, so a search by one finds nothing useful. */
const EMPTY_KEYWORDS = new Set(['b2b', 'b2c', 'business', 'businesses', 'company', 'companies', 'services', 'solutions', 'enterprise', 'enterprises', 'smb', 'smbs', 'sme', 'smes', 'organisation', 'organisations', 'organization', 'organizations'])

/** The answer's fields for one target, in the order the AI is to settle them. Checked as it comes back (generate.ts hands a bad one back to fix). */
export const targetShape = {
  companies: z.string().trim().min(1).max(300).describe('One short sentence: the kinds of company that buy this, and why.'),
  industries: z.array(z.enum(INDUSTRIES as [string, ...string[]])).min(1).max(3),
  companySizes: z.array(z.enum(HEADCOUNT_BUCKETS)).min(1).max(3),
  country: z.union([z.enum(SUPPORTED_COUNTRIES as [string, ...string[]]), z.literal('')]),
  keyword: z
    .string()
    .trim()
    .max(60)
    .refine((k) => !EMPTY_KEYWORDS.has(k.toLowerCase()), "That word marks out no company: use one the companies use about themselves, or leave it empty."),
  people: z.string().trim().min(1).max(250).describe('One short sentence: who at those companies decides to buy it.'),
  titles: z.array(z.string().trim().min(1).max(100)).min(1).max(5),
  seniorities: z.array(z.enum(SENIORITY_LEVELS)),
}

export type Target = z.infer<z.ZodObject<typeof targetShape>>

/** The target as people search's filters. */
export function criteriaOf(t: Target): PersonaCriteria {
  return normalizePersonaCriteria({
    titles: t.titles,
    seniorities: t.seniorities,
    industries: t.industries,
    companySizes: t.companySizes,
    country: t.country,
    keyword: t.keyword,
  })
}

/** What the AI said about the companies and the people, as one passage for the user. */
export const whoOf = (t: Target) => `${t.companies} ${t.people}`
