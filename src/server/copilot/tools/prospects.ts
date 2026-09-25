import { z } from 'zod'
import { defineTool } from '../types'
import { stringOrArray } from './shared'

/**
 * Everyday business shorthand that has no counterpart in LinkedIn's taxonomy.
 * Without this the model asks for "ecommerce" or "SaaS", gets nothing back, and
 * either invents a value (Generect returns 200 with zero results) or gives up.
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
      'Find valid industry values. Generect matches LinkedIn\'s taxonomy exactly and returns zero results for anything outside it — never invent an industry string, always resolve it here first. Call with no query to browse everything.',
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
    name: 'searchProspects',
    description:
      'Search Generect for B2B prospects. Resolve industries through searchIndustries and locations through searchLocations first. This costs money per lookup, so search once with well-chosen filters rather than repeatedly narrowing.',
    input: {
      title: stringOrArray.optional().describe('Job titles, e.g. ["CTO", "VP Engineering"].'),
      company: stringOrArray.optional(),
      location: stringOrArray.optional()
        .describe('Must be exact values from searchLocations — a bare city like "London" is a hard 400.'),
      industry: stringOrArray.optional().describe('Must be exact values from searchIndustries.'),
      seniority: stringOrArray.optional(),
      excludedTitles: stringOrArray.optional(),
      employeeCount: stringOrArray.optional().describe('e.g. ["11-50", "51-200"].'),
      limit: z.number().int().positive().max(100).optional().describe('Defaults to 25.'),
    },
    target: 'server',
    readOnly: true,
    handler: async (args) => {
      // Goes through runProspectSearch, not the raw client: Generect takes only
      // one company_name per request and mishandles multi-bucket headcounts, so
      // calling the client directly silently dropped all but the first value.
      const { runProspectSearch } = await import('../../prospectSearch')
      const result = await runProspectSearch({ ...args, limit: args.limit ?? 25 })
      return {
        count: result.contacts.length,
        totalMatches: result.totalMatches,
        warnings: result.warnings.length > 0 ? result.warnings : undefined,
        prospects: result.contacts.map((p) => ({
          firstName: p.firstName,
          lastName: p.lastName,
          title: p.title,
          company: p.company,
          location: p.location,
          linkedinUrl: p.linkedinUrl,
          email: p.emailAddresses?.[0]?.email ?? null,
        })),
      }
    },
  }),

  defineTool({
    name: 'searchLocations',
    description:
      'Find valid location values. Generect validates locations against LinkedIn\'s vocabulary and returns HTTP 400 for anything outside it, which fails the whole search — never invent a location string, always resolve it here first. Bare region and city names ("California", "London") are rejected; sub-country values must be fully qualified as "Region, Country". Call with no query to browse everything.',
    input: {
      query: z.string().optional()
        .describe('Substring to match, e.g. "london" or "united".'),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ query }) => {
      const { LOCATIONS } = await import(
        '../../../features/prospects/constants/locations'
      )
      if (!query?.trim()) return { count: LOCATIONS.length, locations: LOCATIONS }

      const q = query.toLowerCase().trim()
      const matches = LOCATIONS.filter(l => l.toLowerCase().includes(q))
      if (matches.length > 0) return { count: matches.length, locations: matches }

      // Never answer with an empty array: an invented location is a hard 400,
      // so the model must always have real values to choose from.
      return {
        count: 0,
        locations: LOCATIONS,
        note: `No location matches "${query}". The full vocabulary is returned above — pick the closest value, or tell the user the location is not supported.`,
      }
    },
  }),
]
