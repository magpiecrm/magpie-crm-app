// "Prospect search by AI": the AI reads the workspace's own website, works
// out which companies buy what it sells and who there decides (aiTargets.ts),
// and suggests one people search, as Prospect Search's own filters, with what
// it worked out. It never searches: the page fills its filters with the
// suggestion and the user runs it, since searches cost credits. Claude reads
// the site with its own web fetch and search (copilot/generate.ts), as for
// persona drafts (personaDraft.ts), and is given the website and nothing else.

import { z } from 'zod'
import { AiUnavailable, aiAvailable, generate, type GenerateOptions } from '../copilot/generate'
import type { PersonaCriteria } from '../../features/prospects/types'
import { recordUsage } from '../usage'
import { TARGET_RULES, criteriaOf, targetShape, whoOf } from './aiTargets'

export interface SearchSuggestion {
  criteria: PersonaCriteria
  /** For the user: which companies buy it and why, and who there decides. */
  why: string
}

const SYSTEM = `You help a B2B company find the people its sales team should contact. Read the company's own website, work out what it sells and who buys it, and suggest one people search for the buyers most likely to want it.

Rules:
- Use web fetch on the website you're given: the home page first, then its pricing page and pages about its customers, case studies or industries. Use web search only to find those pages if fetching one fails.
- Base everything on what the pages say, and where they don't say, on what follows plainly from what it sells. No invented customers, claims or numbers.
- The filters are those of a people search on LinkedIn data. ${TARGET_RULES}
- Write "companies" and "people" to the user, in the website's own terms, e.g. "You sell route planning to UK hauliers with their own fleets, who lose time and fuel planning by hand." and "Their operations leaders choose the tools their planners use."
- Never name or describe an individual person, and never search for one.
- Answer by calling the suggestSearch tool.`

const ANSWER = {
  name: 'suggestSearch',
  description: 'Your answer: the people search you suggest, companies first.',
  input: targetShape,
} satisfies GenerateOptions<any>['answer']

/** The answer's shape, for tests. */
export const suggestionAnswer = z.object(ANSWER.input)

/** One search suggested from the website. Throws AiUnavailable (with why) or AiFailed. */
export async function suggestSearch(input: { websiteUrl: string }, deps: { generate?: typeof generate } = {}): Promise<SearchSuggestion> {
  const ai = aiAvailable()
  if (!ai.ok) throw new AiUnavailable(ai.reason)
  if (!ai.web) throw new AiUnavailable("Prospect search by AI reads your website with Claude's web tools, so it needs an Anthropic key: add one in Settings → Copilot.")
  const { answer } = await (deps.generate ?? generate)({
    system: SYSTEM,
    prompt: `Website: ${input.websiteUrl}`,
    answer: ANSWER,
    web: { searches: 2, fetches: 4 },
  })
  recordUsage({ searchSuggestions: 1 })
  // The website's host only: it's the workspace's own.
  console.log(`[Prospect search] AI suggested a search from ${new URL(input.websiteUrl).hostname}`)
  return { criteria: criteriaOf(answer), why: whoOf(answer) }
}
