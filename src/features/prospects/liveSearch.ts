import { useSyncExternalStore } from 'react'
import type { PeopleFound } from './streamPeopleSearch'

// The people a search has found so far, while it's still running. Kept
// outside the page, by search, so that someone who goes to another page and
// comes back finds the search still going and what it has found, rather than
// a blank page: a search takes minutes and nobody sits watching it.

const EMPTY: PeopleFound = { items: [], refined: [] }
/** Searches whose people are kept: the one running and a few before it. */
const KEPT = 5

const found = new Map<string, PeopleFound>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

export const liveSearch = {
  /** A search (or its next page) starts: nothing found yet. */
  start(key: string) {
    found.delete(key)
    found.set(key, EMPTY)
    for (const old of [...found.keys()].slice(0, Math.max(0, found.size - KEPT))) found.delete(old)
    changed()
  },
  add(key: string, more: PeopleFound) {
    const so = found.get(key)
    if (!so) return
    found.set(key, { items: [...so.items, ...more.items], refined: [...so.refined, ...more.refined] })
    changed()
  },
  get: (key: string | null): PeopleFound => (key && found.get(key)) || EMPTY,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}

/** The people found so far by the search with this key, kept up to date. */
export function useLivePeople(key: string | null): PeopleFound {
  return useSyncExternalStore(
    liveSearch.subscribe,
    () => liveSearch.get(key),
    () => EMPTY,
  )
}
