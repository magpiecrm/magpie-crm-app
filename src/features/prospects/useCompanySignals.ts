import { useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { queryKeys } from '../../queryKeys'
import { companySignalsFn } from '../../server/functions'
import { signalKey, withSignals } from '../../server/prospecting/signals'
import type { Signal } from '../../server/prospecting/types'

// Hiring and funding signals for the companies on screen
// (server/prospecting/companySignals.ts), fetched once the results are
// showing, so they never slow a search down. Companies still being looked up
// are asked about again every few seconds, a few times.

type HasCompany = { signals?: Signal[]; name?: string; company?: string; domain?: string | null; companyDomain?: string | null; country?: string | null }

const keyOf = (row: HasCompany) => signalKey({ domain: row.companyDomain ?? row.domain ?? null, name: row.company ?? row.name ?? '' })
const POLL_MS = 5_000
const MAX_POLLS = 6

export function useCompanySignals<T extends HasCompany>(rows: T[], enabled: boolean): T[] {
  const companies = new Map<string, { name: string; domain: string | null; country: string | null }>()
  for (const row of rows) {
    const key = keyOf(row)
    const name = (row.company ?? row.name ?? '').trim()
    if (key && name && !companies.has(key) && companies.size < 50) companies.set(key, { name, domain: row.companyDomain ?? row.domain ?? null, country: row.country ?? null })
  }
  const keys = [...companies.keys()].sort()
  // A few more asks for each set of companies, then it stops asking.
  const polls = useRef(0)
  const asked = useRef('')
  if (asked.current !== keys.join('\n')) {
    asked.current = keys.join('\n')
    polls.current = 0
  }
  const { data } = useQuery({
    queryKey: queryKeys.prospects.signals(keys),
    queryFn: () => companySignalsFn({ data: { companies: [...companies.values()] } }),
    enabled: enabled && keys.length > 0,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    refetchInterval: (query) => (query.state.data?.pending.length && polls.current++ < MAX_POLLS ? POLL_MS : false),
  })
  if (!data) return rows
  return rows.map((row) => {
    const key = keyOf(row)
    const found = key ? data.signals[key] : undefined
    return found?.length ? withSignals(row, found) : row
  })
}
