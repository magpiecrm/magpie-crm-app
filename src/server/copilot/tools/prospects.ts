import { z } from 'zod'
import { defineTool } from '../types'
import { stringOrArray } from './shared'
import { HEADCOUNT_BUCKETS, SENIORITY_LEVELS } from '../../prospecting/types'

/**
 * Everyday business shorthand that has no counterpart in LinkedIn's taxonomy.
 * Without this the model asks for "ecommerce" or "SaaS", gets nothing back, and
 * either invents a value (the industry filter then matches nothing) or gives up.
 */
const ALIASES: Record<string, string[]> = {
  ecommerce: ['Retail', 'Retail Apparel and Fashion', 'Retail Groceries'],
  'e-commerce': ['Retail', 'Retail Apparel and Fashion', 'Retail Groceries'],
  saas: ['Software Development', 'IT Services and IT Consulting'],
  software: ['Software Development'],
  tech: ['Software Development', 'IT Services and IT Consulting', 'Technology, Information and Internet'],
  technology: ['Software Development', 'IT Services and IT Consulting', 'Technology, Information and Internet'],
  fintech: ['Financial Services', 'Capital Markets'],
  finance: ['Financial Services', 'Capital Markets', 'Banking'],
  healthcare: ['Hospitals and Health Care', 'Mental Health Care'],
  health: ['Hospitals and Health Care', 'Mental Health Care'],
  agency: ['Marketing Services', 'Advertising Services', 'Business Consulting and Services'],
  marketing: ['Marketing Services', 'Advertising Services', 'Market Research'],
  consulting: ['Business Consulting and Services', 'IT Services and IT Consulting'],
  manufacturing: ['Industrial Machinery Manufacturing', 'Machinery Manufacturing'],
  property: ['Real Estate', 'Commercial Real Estate'],
  realestate: ['Real Estate', 'Commercial Real Estate'],
  hospitality: ['Hospitality', 'Restaurants', 'Hotels and Motels'],
  education: ['Education Administration Programs', 'Higher Education'],
  logistics: ['Truck Transportation', 'Freight and Package Transportation'],
}

export const prospectTools = [
  defineTool({
    name: 'searchIndustries',
    description:
      'Find valid industry values for searchCompanies. Company industries follow LinkedIn\'s taxonomy, so anything outside it matches nothing — never invent an industry string, always resolve it here first. Call with no query to browse everything.',
    input: {
      query: z.string().optional()
        .describe('Substring to match, e.g. "software" or "ecommerce".'),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ query }) => {
      const { INDUSTRIES } = await import(
        '../../../features/prospects/constants/industries'
      )
      if (!query?.trim()) return { count: INDUSTRIES.length, industries: INDUSTRIES }

      const q = query.toLowerCase().trim()

      const alias = ALIASES[q]
      if (alias) {
        const resolved = alias.filter(a => INDUSTRIES.includes(a))
        if (resolved.length > 0) {
          return {
            count: resolved.length,
            industries: resolved,
            note: `"${query}" is not a value in the taxonomy; these are the closest equivalents.`,
          }
        }
      }

      const matches = INDUSTRIES.filter(i => i.toLowerCase().includes(q))
      if (matches.length > 0) return { count: matches.length, industries: matches }

      // Per-word matching so "online retail" still finds "Retail Apparel and
      // Fashion" and friends.
      const words = q.split(/\s+/).filter(w => w.length > 2)
      const loose = INDUSTRIES.filter(i => {
        const lower = i.toLowerCase()
        return words.some(w => lower.includes(w))
      })
      if (loose.length > 0) {
        return {
          count: loose.length,
          industries: loose,
          note: 'Loose match — confirm one of these is what you meant before using it.',
        }
      }

      // Never answer with an empty array: the model cannot guess a valid value
      // and would otherwise invent one, which silently returns zero prospects.
      return {
        count: 0,
        industries: INDUSTRIES,
        note: `No industry matches "${query}". The full taxonomy is returned above — pick the closest value, or tell the user none applies.`,
      }
    },
  }),

  defineTool({
    name: 'searchCompanies',
    description:
      'Search companies on SocialFetch by keyword (required — e.g. a sector or product term, or a company name). Industry, headcount and country narrow the returned page after the fact, so a very narrow filter can leave few results; use nextCursor for more. Costs credits per call, so search once with a good keyword rather than repeatedly narrowing.',
    input: {
      keyword: z.string().min(1).describe('e.g. "payments", "logistics software", "Acme".'),
      industry: z.string().optional().describe('Exact value from searchIndustries.'),
      headcount: z.array(z.enum(HEADCOUNT_BUCKETS)).optional(),
      country: z.string().optional().describe('Headquarters country, e.g. "United Kingdom".'),
      cursor: z.string().optional().describe('nextCursor from a previous call, for the next page.'),
    },
    target: 'server',
    costsCredits: true,
    readOnly: true,
    handler: async (args) => {
      const { searchCompanies } = await import('../../prospecting/search')
      const page = await searchCompanies(args)
      return {
        count: page.items.length,
        nextCursor: page.nextCursor,
        warnings: page.warnings.length > 0 ? page.warnings : undefined,
        companies: page.items.map((c) => ({
          ref: c.ref,
          name: c.name,
          domain: c.domain,
          industry: c.industry,
          headcount: c.headcount,
          country: c.country,
        })),
      }
    },
  }),

  defineTool({
    name: 'searchPeople',
    description:
      'Find people by job title, optionally at one company (pass its ref and name from searchCompanies). Returns names, current titles and companies only — emails are found when the user saves people to a list in Prospect Search. Every result\'s profile is looked up for their real job and employer, so each result uses about one prospect credit: search once with well-chosen titles.',
    input: {
      companyRef: z.string().optional().describe('`ref` from searchCompanies.'),
      companyName: z.string().optional().describe('Required with companyRef.'),
      titles: stringOrArray.optional().describe('Job title keywords, e.g. ["Head of Marketing", "CMO"]. Up to 5.'),
      seniorities: z.array(z.enum(SENIORITY_LEVELS)).optional(),
      country: z.string().optional(),
      keyword: z.string().optional(),
      industries: z.array(z.string()).optional().describe('Industry names, exactly as searchIndustries returns them.'),
      companySizes: z
        .array(z.enum(HEADCOUNT_BUCKETS))
        .optional()
        .describe("Company sizes by headcount. Each person's employer is looked up and people at other sizes are left out."),
      count: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]).optional().describe('Results per page per title: 25, 50, 75 or 100. Defaults to 25; each result uses about one prospect credit.'),
      cursor: z.string().optional().describe('nextCursor from a previous call.'),
    },
    target: 'server',
    costsCredits: true,
    readOnly: true,
    handler: async ({ companyRef, companyName, titles, count, ...rest }) => {
      const { searchPeople } = await import('../../prospecting/search')
      const page = await searchPeople({
        ...rest,
        count: count ?? 25,
        titles: titles === undefined ? undefined : Array.isArray(titles) ? titles : [titles],
        company: companyRef ? { ref: companyRef, name: companyName ?? companyRef } : null,
      })
      return {
        count: page.items.length,
        nextCursor: page.nextCursor,
        warnings: page.warnings.length > 0 ? page.warnings : undefined,
        people: page.items.map((p) => ({
          name: `${p.firstName} ${p.lastName}`.trim(),
          title: p.title,
          seniority: p.seniority,
          company: p.company,
          country: p.country,
        })),
      }
    },
  }),
]
