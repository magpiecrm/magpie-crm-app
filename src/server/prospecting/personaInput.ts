import { z } from 'zod'
import { HEADCOUNT_BUCKETS, SENIORITY_LEVELS } from './types'
import { INDUSTRIES } from '../../features/prospects/constants/industries'

/** A persona's criteria as search takes them (features/prospects/types.ts): list values only, so applying one never searches for nothing. */
export const personaCriteriaInput = z.object({
  titles: z.array(z.string().trim().min(1).max(200)).max(10),
  seniorities: z.array(z.enum(SENIORITY_LEVELS)),
  industries: z.array(z.enum(INDUSTRIES as [string, ...string[]])),
  companySizes: z.array(z.enum(HEADCOUNT_BUCKETS)),
  country: z.string().trim().max(100),
  keyword: z.string().trim().max(200),
})

export const personaInput = z.object({
  name: z.string().trim().min(1, 'Give the persona a name').max(200),
  description: z.string().max(2_000),
  criteria: personaCriteriaInput,
  painPoints: z.string().max(5_000),
  valueProp: z.string().max(5_000),
})

/** The workspace's own website, for the AI to read (persona drafts, a suggested search). "acme.com" is taken as https://acme.com. */
export const websiteUrlInput = z
  .string()
  .trim()
  .min(1, "Enter your company's website")
  .transform((u) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : `https://${u}`))
  .pipe(z.httpUrl({ message: "That doesn't look like a website address" }).max(300))
