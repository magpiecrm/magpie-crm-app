// Personas drafted by the AI from the workspace's own website, for the
// Personas page: who buys what it sells, as Prospect Search's own filters,
// with their pain points and why they'd care. Claude reads the site with its
// own web fetch and search (copilot/generate.ts); nothing goes through our web
// search or proxy. It's given the website and the user's note and nothing
// else: no contact, no search result.

import { z } from 'zod'
import { AiUnavailable, aiAvailable, generate, type GenerateOptions } from '../copilot/generate'
import { normalizePersonaCriteria, type PersonaCriteria } from '../../features/prospects/types'
import { recordUsage } from '../usage'
import { personaCriteriaInput } from './personaInput'

export interface PersonaDraft {
  name: string
  description: string
  criteria: PersonaCriteria
  painPoints: string
  valueProp: string
}

export const MAX_DRAFTS = 3

const SYSTEM = `You help a B2B company decide who its sales team should prospect. Read the company's own website and suggest the buyer personas for what it sells: the people who decide to buy it.

Rules:
- Use web fetch on the website you're given: the home page first, then pages about its products, pricing, customers or case studies. Use web search only to find those pages if fetching one fails.
- Base everything on what the pages say: who it serves, in which industries, company sizes and countries, and which problems it solves. Nothing guessed.
- 1 to ${MAX_DRAFTS} personas, each a different buyer (a different role, or a different kind of company), the most promising first.
- Criteria are the filters of a people search on LinkedIn data:
  - titles: at most 5 job titles as people write them on LinkedIn, e.g. "Head of Marketing", "CFO", "Operations Manager". "Sales leaders", "Marketing leaders", "Operations leaders", "Finance leaders" and "Engineering leaders" each find that department's Heads, VPs and Directors.
  - seniorities: only where it narrows the titles usefully; usually empty.
  - industries: the industries of the companies these people work at, only from the allowed values. Empty rather than a guess.
  - companySizes: staff-count bands of those companies, where the website makes them clear. A size needs an industry or a keyword as well.
  - country: one country, only where the website plainly sells in one market; otherwise empty.
  - keyword: one word or short phrase companies like theirs are found by, e.g. "logistics", or empty.
- name: a few words, e.g. "Marketing leaders at SaaS companies". description: one sentence on who they are. painPoints and valueProp: two or three short plain sentences each, in the website's own terms, never invented claims or numbers.
- Never name or describe an individual person, and never search for one.
- Answer by calling the suggestPersonas tool.`

const ANSWER = {
  name: 'suggestPersonas',
  description: 'Your answer: the buyer personas you suggest, the most promising first.',
  input: {
    personas: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          description: z.string().trim().max(300),
          painPoints: z.string().trim().max(800),
          valueProp: z.string().trim().max(800),
          criteria: personaCriteriaInput.extend({ titles: z.array(z.string().trim().min(1).max(100)).max(5) }),
        }),
      )
      .min(1)
      .max(MAX_DRAFTS),
  },
} satisfies GenerateOptions<any>['answer']

export function draftPrompt(websiteUrl: string, note?: string): string {
  return [`Website: ${websiteUrl}`, note?.trim() ? `What they added about who they sell to:\n${note.trim()}` : null].filter(Boolean).join('\n\n')
}

/** Up to three personas from the website. Throws AiUnavailable (with why) or AiFailed. */
export async function draftPersonas(input: { websiteUrl: string; note?: string }, deps: { generate?: typeof generate } = {}): Promise<PersonaDraft[]> {
  const ai = aiAvailable()
  if (!ai.ok) throw new AiUnavailable(ai.reason)
  if (!ai.web) throw new AiUnavailable("Drafting personas reads your website with Claude's web tools, so it needs an Anthropic key: add one in Settings → Copilot.")
  const { answer } = await (deps.generate ?? generate)({
    system: SYSTEM,
    prompt: draftPrompt(input.websiteUrl, input.note),
    answer: ANSWER,
    web: { searches: 2, fetches: 4 },
  })
  recordUsage({ personaDrafts: 1 })
  // The website's host only: it's the workspace's own.
  console.log(`[Personas] Drafted ${answer.personas.length} from ${new URL(input.websiteUrl).hostname}`)
  return answer.personas.map((p) => ({ ...p, criteria: normalizePersonaCriteria(p.criteria) }))
}
