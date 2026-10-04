import type { z } from 'zod'
import type { peopleSearchInput, searchPeopleFn } from '../../server/functions'
import type { PersonResult } from '../../server/prospecting/types'

export type PeopleSearchPage = Awaited<ReturnType<typeof searchPeopleFn>>
export interface PeopleFound {
  items: PersonResult[]
  refined: string[]
}

/**
 * Runs a people search through /api/prospects/search, handing over each
 * batch of people as it's found (`onPeople`), and resolves with the finished
 * page, the same as searchPeopleFn's.
 */
export async function streamPeopleSearch(
  input: z.input<typeof peopleSearchInput>,
  onPeople: (found: PeopleFound) => void,
  signal?: AbortSignal,
): Promise<PeopleSearchPage> {
  const res = await fetch('/api/prospects/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(res.status === 401 ? 'Your session has ended. Sign in again.' : `Search failed (${res.status}).`)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffered += value
    const lines = buffered.split('\n')
    buffered = done ? '' : lines.pop()!
    for (const line of lines) {
      if (!line.trim()) continue
      const msg = JSON.parse(line) as { type: 'people'; items: PersonResult[]; refined: string[] } | { type: 'done'; page: PeopleSearchPage } | { type: 'error'; message: string }
      if (msg.type === 'people') onPeople({ items: msg.items, refined: msg.refined })
      else if (msg.type === 'done') return msg.page
      else throw new Error(msg.message)
    }
    if (done) throw new Error('The search stopped before it finished. Try again.')
  }
}
