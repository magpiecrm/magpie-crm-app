// Personas drafted by the AI from the workspace's own website, for the
// Personas page: who buys what it sells, as Prospect Search's own filters,
// with their pain points and why they'd care. The AI works out the companies
// that buy first, then the people there (aiTargets.ts). Claude reads the site
// with its own web fetch and search (copilot/generate.ts); nothing goes
// through our web search or proxy. It's given the website and the user's note
// and nothing else: no contact, no search result.

import { z } from 'zod'
import { AiUnavailable, aiAvailable, generate, type GenerateOptions } from '../copilot/generate'
import type { PersonaCriteria } from '../../features/prospects/types'
import { recordUsage } from '../usage'
import { TARGET_RULES, criteriaOf, targetShape, whoOf } from './aiTargets'

export interface PersonaDraft {
  name: string
  /** Which companies, and who there: what the AI worked out, in its words. */
  description: string
  criteria: PersonaCriteria
  painPoints: string
  valueProp: string
}

export const MAX_DRAFTS = 3

const SYSTEM = `You help a B2B company decide who its sales team should prospect. Read the company's own website and suggest the buyer personas for what it sells: the people who decide to buy it, at the companies that buy it.

Rules:
- Use web fetch on the website you're given: the home page first, then its pricing page and pages about its customers, case studies or industries. Use web search only to find those pages if fetching one fails.
- Base everything on what the pages say, and where they don't say, on what follows plainly from what it sells. No invented customers, claims or numbers.
- 1 to ${MAX_DRAFTS} personas, the most promising first. Each is a different buyer: a different kind of company, or a different person at the same kind of company.
- For each persona, the filters are those of a people search on LinkedIn data. ${TARGET_RULES}
- name: a few words naming both, e.g. "Operations leaders at UK hauliers". painPoints and valueProp: two or three short plain sentences each, in the website's own terms.
- Never name or describe an individual person, and never search for one.
- Answer by calling the suggestPersonas tool.`

const ANSWER = {
  name: 'suggestPersonas',
  description: 'Your answer: the buyer personas you suggest, the most promising first.',
  input: {
    personas: z
      .array(
        z.object({
          ...targetShape,
          name: z.string().trim().min(1).max(80),
          painPoints: z.string().trim().max(800),
          valueProp: z.string().trim().max(800),
        }),
      )
      .min(1)
      .max(MAX_DRAFTS),
  },
} satisfies GenerateOptions<any>['answer']

/** The answer's shape, for tests. */
export const draftAnswer = z.object(ANSWER.input)

export function draftPrompt(websiteUrl: string, note?: string): string {
  return [`Website: ${websiteUrl}`, note?.trim() ? `What they added about who they sell to:\n${note.trim()}` : null].filter(Boolean).join('\n\n')
}

/** Throws AiUnavailable, saying why, where personas can't be drafted here. */
export function requireDraftAi(): void {
  const ai = aiAvailable()
  if (!ai.ok) throw new AiUnavailable(ai.reason)
  if (!ai.web) throw new AiUnavailable("Drafting personas reads your website with Claude's web tools, so it needs an Anthropic key: add one in Settings → Copilot.")
}

/** Up to three personas from the website. Throws AiUnavailable (with why) or AiFailed. */
export async function draftPersonas(
  input: { websiteUrl: string; note?: string },
  deps: { generate?: typeof generate; signal?: AbortSignal } = {},
): Promise<PersonaDraft[]> {
  requireDraftAi()
  const { answer } = await (deps.generate ?? generate)({
    system: SYSTEM,
    prompt: draftPrompt(input.websiteUrl, input.note),
    answer: ANSWER,
    web: { searches: 2, fetches: 4 },
    signal: deps.signal,
  })
  recordUsage({ personaDrafts: 1 })
  // The website's host only: it's the workspace's own.
  console.log(`[Personas] Drafted ${answer.personas.length} from ${new URL(input.websiteUrl).hostname}`)
  return answer.personas.map((p) => ({ name: p.name, description: whoOf(p), criteria: criteriaOf(p), painPoints: p.painPoints, valueProp: p.valueProp }))
}
