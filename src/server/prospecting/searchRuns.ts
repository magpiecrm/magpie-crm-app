// People searches that are running, or that finished with nobody there to
// see them. A search takes minutes, and whoever started it may leave the
// page, lose their connection or ask again: without this the search carried
// on unseen, was paid for, and asking again started a second one beside it.
//
// A request for a search that's already running joins it: it's handed the
// people found so far and then follows along. One that finished unseen is
// kept for an hour and handed to the next request for the same search,
// instead of being run (and charged) again.
//
// In server memory only, never on disk, and size-capped: like searchPool.ts
// and profileCache.ts, a short-lived exception to search results not being
// kept.

export type SearchLine<Page> =
  | { type: 'people'; items: unknown[]; refined: string[] }
  | { type: 'done'; page: Page }
  | { type: 'error'; message: string }

/** Takes a line; says whether it reached whoever is listening. */
type Listener<Page> = (line: SearchLine<Page>) => boolean

interface Run<Page> {
  people: Array<SearchLine<Page>>
  ended: SearchLine<Page> | null
  endedAt: number
  listeners: Set<Listener<Page>>
}

const HELD_MS = 60 * 60_000
const MAX_HELD = 20

const runs = new Map<string, Run<any>>()

/** For tests: forget every search. */
export const forgetSearchRuns = () => runs.clear()

function prune(now: number) {
  const ended = [...runs].filter(([, r]) => r.ended)
  for (const [key, r] of ended) if (now - r.endedAt > HELD_MS) runs.delete(key)
  const held = [...runs].filter(([, r]) => r.ended).sort((a, b) => a[1].endedAt - b[1].endedAt)
  for (const [key] of held.slice(0, Math.max(0, held.length - MAX_HELD))) runs.delete(key)
}

/**
 * Follows the search `key` stands for, starting it with `start` unless it's
 * already running or was finished with nobody there. The listener gets the
 * people found so far, each batch after that, and then how it ended. Returns
 * a way to stop listening; the search itself carries on regardless.
 */
export function joinSearch<Page>(
  key: string,
  start: (onPeople: (found: { items: unknown[]; refined: string[] }) => void) => Promise<Page>,
  listener: Listener<Page>,
  now = Date.now(),
): () => void {
  prune(now)
  const existing = runs.get(key) as Run<Page> | undefined
  if (existing) {
    for (const line of existing.people) listener(line)
    if (existing.ended) {
      // Kept for whoever asked next: once they have it, it's theirs.
      if (listener(existing.ended)) runs.delete(key)
      return () => {}
    }
    existing.listeners.add(listener)
    return () => void existing.listeners.delete(listener)
  }

  const run: Run<Page> = { people: [], ended: null, endedAt: 0, listeners: new Set([listener]) }
  runs.set(key, run)
  const tell = (line: SearchLine<Page>) => [...run.listeners].map((l) => l(line)).some(Boolean)
  const end = (line: SearchLine<Page>) => {
    run.ended = line
    run.endedAt = Date.now()
    const seen = tell(line)
    run.listeners.clear()
    // Seen, or nothing worth keeping: a search that failed is simply asked for again.
    if (seen || line.type === 'error') runs.delete(key)
  }
  start((found) => {
    const line: SearchLine<Page> = { type: 'people', ...found }
    run.people.push(line)
    tell(line)
  }).then(
    (page) => end({ type: 'done', page }),
    (err) => end({ type: 'error', message: err instanceof Error ? err.message : 'Search failed' }),
  )
  return () => void run.listeners.delete(listener)
}
