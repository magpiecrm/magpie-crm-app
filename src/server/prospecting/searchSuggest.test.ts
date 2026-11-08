import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// "Prospect search by AI": one search from the workspace's own website, as
// search's own filter values, checked as it comes back. The model's API is
// faked under the real generate(), so a bad answer goes back to it to fix.

// Scratch database (usage counts are written to it), so this never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'search-suggest-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { suggestSearch, suggestionAnswer } = await import('./searchSuggest')
const { generate, AiUnavailable } = await import('../copilot/generate')
const { websiteUrlInput } = await import('./personaInput')
const { monthOf, usageForMonth } = await import('../usage')

const ENV = ['COPILOT_MANAGED', 'REACHER_URL', 'REACHER_SECRET', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const
const original = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
beforeEach(() => {
  for (const k of ENV) delete process.env[k]
  process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-owncopykey000000000000'
})
afterEach(() => {
  for (const k of ENV) {
    if (original[k] === undefined) delete process.env[k]
    else process.env[k] = original[k]
  }
})
afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const claude = (content: unknown[], stop_reason = 'tool_use') =>
  new Response(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', content, stop_reason }), { status: 200, headers: { 'content-type': 'application/json' } })
const answer = (input: unknown, id = 'tu_1') => claude([{ type: 'tool_use', id, name: 'suggestSearch', input }])

/** The real generate(), over a faked Messages API that gives these replies in turn. */
function fakeAi(...responses: Response[]) {
  const calls: any[] = []
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)))
    return responses.shift() ?? claude([{ type: 'text', text: '(no more)' }], 'end_turn')
  }) as unknown as typeof fetch
  return { calls, generate: ((opts: Parameters<typeof generate>[0]) => generate({ ...opts, fetchImpl })) as typeof generate }
}

const good = {
  criteria: { titles: ['Operations leaders', 'COO'], seniorities: [], industries: ['Truck Transportation'], companySizes: ['201-500', '51-200'], country: 'United Kingdom', keyword: '' },
  why: 'You sell route planning to UK hauliers, and their operations leaders choose it.',
}

describe('suggestSearch', () => {
  it('reads the website with web tools, gives the AI nothing but the website, and counts it', async () => {
    const before = usageForMonth(monthOf(new Date())).searchSuggestions
    const ai = fakeAi(answer(good))
    const suggestion = await suggestSearch({ websiteUrl: 'https://haulwise.test' }, { generate: ai.generate })

    expect(ai.calls).toHaveLength(1)
    const body = ai.calls[0]
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].content.map((c: any) => c.text)).toEqual(['Website: https://haulwise.test'])
    expect(body.tools.map((t: any) => t.type ?? t.name)).toEqual(['suggestSearch', 'web_search_20250305', 'web_fetch_20250910'])
    expect(body.tools[1]).toMatchObject({ max_uses: 2 })
    expect(body.tools[2]).toMatchObject({ max_uses: 4 })
    // The model is shown search's own values to choose from.
    const criteria = body.tools[0].input_schema.properties.criteria.properties
    expect(criteria.industries.items.enum).toContain('Truck Transportation')
    expect(criteria.companySizes.items.enum).toEqual(['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'])
    expect(criteria.seniorities.items.enum).toContain('director')

    // Sizes come back in bucket order, as everywhere else.
    expect(suggestion).toEqual({ criteria: { ...good.criteria, companySizes: ['51-200', '201-500'] }, why: good.why })
    expect(usageForMonth(monthOf(new Date())).searchSuggestions).toBe(before + 1)
  })

  it('hands a search it can’t run back to the AI to fix, and uses the fixed one', async () => {
    const offList = { ...good, criteria: { ...good.criteria, industries: ['Haulage'], country: 'Atlantis' } }
    const ai = fakeAi(answer(offList, 'tu_1'), answer(good, 'tu_2'))
    const suggestion = await suggestSearch({ websiteUrl: 'https://haulwise.test' }, { generate: ai.generate })

    expect(ai.calls).toHaveLength(2)
    const retry = ai.calls[1].messages.at(-1).content[0]
    expect(retry).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: true })
    expect(JSON.stringify(retry.content)).toMatch(/industries/)
    expect(JSON.stringify(retry.content)).toMatch(/country/)
    expect(suggestion.criteria.industries).toEqual(['Truck Transportation'])
  })

  it("says why when there's no AI, or no web tools to read the website with", async () => {
    const ai = fakeAi()
    delete process.env.ANTHROPIC_API_KEY
    await expect(suggestSearch({ websiteUrl: 'https://haulwise.test' }, { generate: ai.generate })).rejects.toThrow('Settings → Copilot')
    process.env.OPENAI_API_KEY = 'sk-proj-openaikey00000000000000000000'
    await expect(suggestSearch({ websiteUrl: 'https://haulwise.test' }, { generate: ai.generate })).rejects.toBeInstanceOf(AiUnavailable)
    expect(ai.calls).toHaveLength(0)
  })
})

describe('the answer it takes', () => {
  const check = (criteria: Partial<typeof good.criteria>) => suggestionAnswer.safeParse({ ...good, criteria: { ...good.criteria, ...criteria } })
  const problem = (criteria: Partial<typeof good.criteria>) => {
    const parsed = check(criteria)
    return parsed.success ? null : parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  }

  it('is a search that can run, from the lists search uses', () => {
    expect(check({}).success).toBe(true)
    // A keyword alone is a search; so is a country from the list, or none.
    expect(check({ titles: [], keyword: 'logistics', industries: [], companySizes: [], country: '' }).success).toBe(true)

    expect(problem({ titles: [], keyword: '' })).toBe('criteria.titles')
    expect(problem({ industries: [], keyword: '' })).toBe('criteria.companySizes')
    expect(problem({ industries: ['Haulage'] })).toBe('criteria.industries.0')
    expect(problem({ country: 'Atlantis' })).toBe('criteria.country')
    expect(problem({ seniorities: ['boss' as never] })).toBe('criteria.seniorities.0')
    expect(problem({ companySizes: ['50-100' as never] })).toBe('criteria.companySizes.0')
    expect(problem({ titles: ['CEO', 'CFO', 'COO', 'CTO', 'CMO', 'CRO'] })).toBe('criteria.titles')
    expect(suggestionAnswer.safeParse({ ...good, why: ' ' }).success).toBe(false)
  })
})

describe('the website it reads', () => {
  it('takes a bare domain as https, and refuses anything else', () => {
    expect(websiteUrlInput.parse(' haulwise.co.uk ')).toBe('https://haulwise.co.uk')
    expect(websiteUrlInput.parse('http://haulwise.test/about')).toBe('http://haulwise.test/about')
    expect(websiteUrlInput.safeParse('').success).toBe(false)
    expect(websiteUrlInput.safeParse('ftp://haulwise.test').success).toBe(false)
    expect(websiteUrlInput.safeParse('not a website').success).toBe(false)
    expect(websiteUrlInput.safeParse('localhost:3000').success).toBe(false)
  })
})
