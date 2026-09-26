import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Building2, Loader2, Search } from 'lucide-react'
import { searchCompaniesFn } from '../../../server/functions'
import type { CompanyResult } from '../../../server/prospecting/types'

const MAX_MATCHES = 8

/**
 * Optional "limit to one company" filter for people search. Looking a company
 * up is a paid company search, so it only runs when the user presses Find,
 * never on each keystroke.
 */
export function CompanyPicker({ onPick }: { onPick: (company: CompanyResult) => void }) {
  const [name, setName] = useState('')
  const lookup = useMutation({
    mutationFn: (keyword: string) => searchCompaniesFn({ data: { keyword } }),
  })

  const find = () => {
    if (name.trim()) lookup.mutate(name.trim())
  }

  const matches = lookup.data?.items.slice(0, MAX_MATCHES) ?? []

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (lookup.data || lookup.error) lookup.reset()
          }}
          // Enter looks the company up instead of submitting the people search.
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              find()
            }
          }}
          placeholder="Any company (optional)"
          className="w-full min-w-0 px-2 py-1.5 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-accent focus:border-transparent outline-none"
        />
        <button
          type="button"
          onClick={find}
          disabled={!name.trim() || lookup.isPending}
          className="shrink-0 px-2 py-1.5 text-xs font-semibold border border-border rounded hover:bg-muted disabled:opacity-50 flex items-center gap-1"
        >
          {lookup.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          Find
        </button>
      </div>

      {lookup.error && <p className="text-[10px] text-destructive leading-snug">{(lookup.error as Error).message}</p>}

      {lookup.isSuccess && matches.length === 0 && (
        <p className="text-[10px] text-muted-foreground leading-snug">No companies matched “{lookup.variables}”. Try a shorter name.</p>
      )}

      {matches.length > 0 && (
        <ul className="border border-border rounded bg-background divide-y divide-border max-h-56 overflow-y-auto">
          {matches.map((c) => (
            <li key={c.ref}>
              <button
                type="button"
                onClick={() => {
                  onPick(c)
                  setName('')
                  lookup.reset()
                }}
                className="w-full text-left px-2 py-1.5 hover:bg-muted flex items-start gap-2"
              >
                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-foreground truncate">{c.name}</span>
                  <span className="block text-[10px] text-muted-foreground truncate">
                    {[c.domain, c.headcount !== null ? `${c.headcount.toLocaleString()} staff` : null, c.country].filter(Boolean).join(' · ') || 'No website listed'}
                  </span>
                  {c.catchAll && (
                    <span className="block text-[10px] font-semibold text-amber-700 dark:text-amber-400" title="This company's mail server accepts every address, so no email there can be verified.">
                      Can't verify emails here
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!lookup.data && (
        <p className="text-[10px] text-muted-foreground leading-snug">Leave blank to search every company. Find costs 3 credits.</p>
      )}
    </div>
  )
}
