import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import { checkAuthFn, warmPeopleSearchFn } from '../../server/functions'

/**
 * How often, at most, the page asks again while filters change: inside the 8
 * minutes the host keeps a warmed browser waiting for a search.
 */
export const WARM_EVERY_MS = 4 * 60_000

/** Whether to ask now: switched on, the page in view, and not asked in the last few minutes. */
export function shouldWarm(on: boolean, visible: boolean, lastAt: number | null, now: number): boolean {
  return on && visible && (lastAt === null || now - lastAt >= WARM_EVERY_MS)
}

/**
 * Where the host runs the verified people search, asks it to get its search
 * browsers past Google's challenge while someone chooses filters: when the
 * page opens, and again as the filters change, every few minutes at most.
 * Without it, the first search after a quiet spell spends about 45 seconds
 * on that before anyone shows. `activity` is anything that changes as they
 * work on the filters.
 *
 * Never in a view-only session: the host's staff looking at a copy aren't
 * about to search, and the copy refuses the request, which its banner would
 * show as something they tried to change.
 */
export function useSearchWarmup(on: boolean, activity: unknown) {
  const { data: account } = useQuery({ queryKey: queryKeys.account(), queryFn: () => checkAuthFn(), staleTime: 5 * 60_000 })
  const ready = on && account !== undefined && !account.viewOnly
  const lastAt = useRef<number | null>(null)
  useEffect(() => {
    const now = Date.now()
    if (!shouldWarm(ready, document.visibilityState === 'visible', lastAt.current, now)) return
    lastAt.current = now
    // A hint: the search works the same without it.
    warmPeopleSearchFn().catch(() => {})
  }, [ready, activity])
}
