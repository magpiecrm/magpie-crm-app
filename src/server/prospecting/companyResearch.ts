// What a personalised sequence email can say about someone's company
// (sequences/personalise.ts): a few short facts, each with where it was read,
// found by the AI with Claude's own web search and fetch (copilot/generate.ts).
// Nothing goes through our own web search (webSearch.ts) or the live signal
// lookups (companySignals.ts), which run through the proxy; what those have
// already found is passed in.
//
// The research is given the company and nothing else: its name, website and
// country, never the person being written to, so its searches can't name
// them. Facts about named people are asked to be left out. What it finds is
// company data, kept by company (db company_research) so everyone at the
// same company shares one lookup.

import type { ResearchFact } from '../../features/sequences/types'
import { aiAvailable, generate, type GenerateOptions } from '../copilot/generate'
import { recordUsage } from '../usage'
import { signalKey } from './signals'
import { z } from 'zod'

type Db = typeof import('../db')['db']

export interface ResearchCompany {
  name: string
  domain: string | null
  country: string | null
}

export interface Research {
  facts: ResearchFact[]
  /** Claude's web tools were used (not where only OpenAI is set up). */
  web: boolean
  at: string
}

const DAY = 86_400_000
/** How long research is kept: what was found, and that nothing was. */
export const RESEARCH_TTL = { found: 30 * DAY, none: 7 * DAY }
export const MAX_FACTS = 6

const SYSTEM = `You research companies for a salesperson about to write to someone who works there. Find a few true, specific, recent facts about the company that a short sales email could mention: what it does and for whom, products or services, notable customers or markets, recent news, launches, expansion, hiring or funding.

Rules:
- Use the web search and fetch tools. Start with the company's own website when one is given, then search for recent news by the company's name.
- Facts about the company only. Never name or describe an individual person (founders, staff, customers), and never search for one.
- Each fact is one short sentence of at most 25 words, stated plainly, with the URL of the page it came from. Prefer the last 12 months; say when something happened.
- Only what the pages actually say. Nothing guessed, and nothing about a different company with a similar name: if you can't tell it's the same company, leave it out.
- At most ${MAX_FACTS} facts, the most useful first. If you find nothing reliable, answer with no facts.
- Answer by calling the companyFacts tool.`

const ANSWER = {
  name: 'companyFacts',
  description: "Your answer: the facts you found about the company, each with the URL of the page it's from.",
  input: {
    facts: z
      .array(z.object({ text: z.string().describe('One short sentence about the company.'), url: z.string().nullable().describe('The page it came from, or null.') }))
      .describe(`At most ${MAX_FACTS}; empty when nothing reliable was found.`),
  },
} satisfies GenerateOptions<any>['answer']

/** What this copy already knows about the company: its staff count and growth, and signals found earlier. */
export function knownFacts(c: ResearchCompany, db: Pick<Db, 'data' | 'getCompanySignal'>): ResearchFact[] {
  const out: ResearchFact[] = []
  const domain = c.domain?.toLowerCase()
  const company = domain ? db.data.prospect_companies?.find((p) => p.domain?.toLowerCase() === domain) : undefined
  const history = company?.headcount_history ?? []
  if (history.length >= 2) {
    const first = history[0]
    const last = history[history.length - 1]
    const months = Math.round((Date.parse(last.at) - Date.parse(first.at)) / (30 * DAY))
    if (months >= 1 && last.n !== first.n) out.push({ text: `Staff on its LinkedIn page went from ${first.n} to ${last.n} in about ${months} month${months === 1 ? '' : 's'}.`, url: null })
  } else if (typeof company?.headcount === 'number' && company.headcount > 0) {
    out.push({ text: `About ${company.headcount} staff.`, url: null })
  }
  const key = signalKey(c)
  for (const kind of ['hiring', 'funding'] as const) {
    const s = key ? db.getCompanySignal(key, kind)?.signal : null
    if (s) out.push({ text: [s.label, s.detail].filter(Boolean).join(': '), url: s.url ?? null })
  }
  return out
}

function cleanFacts(raw: Array<{ text: string; url: string | null }>): ResearchFact[] {
  const seen = new Set<string>()
  const out: ResearchFact[] = []
  for (const f of raw) {
    const text = f.text.replace(/\s+/g, ' ').trim().slice(0, 300)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    const url = f.url && /^https?:\/\/[^\s]+$/i.test(f.url.trim()) ? f.url.trim() : null
    out.push({ text, url })
    if (out.length >= MAX_FACTS) break
  }
  return out
}

export function researchPrompt(c: ResearchCompany, known: ResearchFact[]): string {
  return [
    `Company: ${c.name}`,
    c.domain ? `Website: https://${c.domain}/` : 'Website: not known; find it by searching for the company.',
    c.country ? `Country: ${c.country}` : null,
    known.length ? `Already known (keep what's still useful, with its source):\n${known.map((f) => `- ${f.text}${f.url ? ` (${f.url})` : ''}`).join('\n')}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

// Two people at the same company being written to at once share one lookup.
const running = new Map<string, Promise<Research>>()

/** The facts for a company: kept ones while fresh, otherwise looked up now. Throws the AI's errors (generate.ts). */
export async function researchCompany(
  c: ResearchCompany,
  deps: { db?: Db; generate?: typeof generate; web?: boolean; now?: Date; signal?: AbortSignal; save?: boolean } = {},
): Promise<Research> {
  const db = deps.db ?? (await import('../db')).db
  const now = deps.now ?? new Date()
  const key = signalKey(c)
  if (!key) return { facts: [], web: false, at: now.toISOString() }

  const ai = aiAvailable()
  const web = deps.web ?? (ai.ok && ai.web)
  const kept = db.getCompanyResearch(key)
  const fresh = kept && now.getTime() - Date.parse(kept.at) < (kept.facts.length ? RESEARCH_TTL.found : RESEARCH_TTL.none)
  // Kept research done without web tools is looked up again once they're there.
  if (kept && fresh && (kept.web || !web)) return kept
  // Without Claude's web tools there's nothing new to find: what's known is the research.
  if (!web) return { facts: cleanFacts(knownFacts(c, db)), web: false, at: now.toISOString() }

  const inFlight = running.get(key)
  if (inFlight) return inFlight
  const job = (async (): Promise<Research> => {
    const known = knownFacts(c, db)
    const { answer } = await (deps.generate ?? generate)({
      system: SYSTEM,
      prompt: researchPrompt(c, known),
      answer: ANSWER,
      web: { searches: 3, fetches: 2 },
      signal: deps.signal,
    })
    recordUsage({ researchCalls: 1 })
    const facts = cleanFacts(answer.facts)
    // Domains only in logs: a small firm's name can be a person's.
    console.log(`[Research] ${c.domain ?? 'no website'}: ${facts.length} fact${facts.length === 1 ? '' : 's'}`)
    if (deps.save !== false) db.setCompanyResearch(key, { facts, web: true }, now)
    return { facts, web: true, at: now.toISOString() }
  })()
  running.set(key, job)
  try {
    return await job
  } finally {
    running.delete(key)
  }
}
