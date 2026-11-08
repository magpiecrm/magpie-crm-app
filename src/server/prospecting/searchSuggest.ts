// "Prospect search by AI": the AI reads the workspace's own website, works
// out what it sells and who buys it, and suggests one people search, as
// Prospect Search's own filters, with a sentence on why. It never searches:
// the page fills its filters with the suggestion and the user runs it, since
// searches cost credits. Claude reads the site with its own web fetch and
// search (copilot/generate.ts), as for persona drafts (personaDraft.ts), and
// is given the website and nothing else.

import { z } from 'zod'
import { AiUnavailable, aiAvailable, generate, type GenerateOptions } from '../copilot/generate'
import { normalizePersonaCriteria, type PersonaCriteria } from '../../features/prospects/types'
import { recordUsage } from '../usage'
import { SUPPORTED_COUNTRIES } from './geo'
import { CRITERIA_RULES } from './personaDraft'
import { personaCriteriaInput } from './personaInput'

export interface SearchSuggestion {
  criteria: PersonaCriteria
  /** One sentence for the user: what they sell, and why these people buy it. */
  why: string
}

const SYSTEM = `You help a B2B company find the people its sales team should contact. Read the company's own website, work out what it sells and who buys it, and suggest one people search for the buyers most likely to want it.

Rules:
- Use web fetch on the website you're given: the home page first, then pages about its products, pricing, customers or case studies. Use web search only to find those pages if fetching one fails.
- Base everything on what the pages say: who it serves, in which industries, company sizes and countries, and which problems it solves. Nothing guessed.
- The search's filters, on LinkedIn data:
${CRITERIA_RULES}
- The country, like the industries, only from the allowed values.
- At least one job title or a keyword: a search needs one. Every filter narrows the search, so leave out any the website doesn't make clear.
- why: one plain sentence to the user on what they sell and why these people would buy it, e.g. "You sell route planning to UK hauliers, and their operations leaders choose the tools their planners use." In the website's own terms, with no invented claims or numbers.
- Never name or describe an individual person, and never search for one.
- Answer by calling the suggestSearch tool.`

// Checked as the answer comes back: a bad one goes back to the AI with what's wrong, to fix (generate.ts).
const ANSWER = {
  name: 'suggestSearch',
  description: 'Your answer: the people search you suggest, and why.',
  input: {
    criteria: personaCriteriaInput
      .extend({
        titles: z.array(z.string().trim().min(1).max(100)).max(5),
        country: z.union([z.enum(SUPPORTED_COUNTRIES as [string, ...string[]]), z.literal('')]),
      })
      .refine((c) => c.titles.length > 0 || c.keyword !== '', { message: 'Give at least one job title or a keyword: a search needs one.', path: ['titles'] })
      .refine((c) => c.companySizes.length === 0 || c.industries.length > 0 || c.keyword !== '', {
        message: 'Company sizes need an industry or a keyword as well, to find those companies by. Add one, or leave the sizes out.',
        path: ['companySizes'],
      }),
    why: z.string().trim().min(1).max(400),
  },
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
  return { criteria: normalizePersonaCriteria(answer.criteria), why: answer.why }
}
