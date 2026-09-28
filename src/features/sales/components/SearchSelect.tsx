import { useId, useMemo, useState } from 'react'
import { Loader2, Plus, Search } from 'lucide-react'

export interface SearchOption {
  id: string
  label: string
  /** Muted second line, e.g. an email or a domain. */
  sub?: string | null
}

const MAX_SHOWN = 8

/**
 * A search box with a list of matches under it, for picking one record out of
 * many (a company, a contact). The list sits in the flow rather than floating,
 * so it is never clipped by a dialog. Arrow keys move, Enter picks, Escape closes.
 */
export function SearchSelect({
  options,
  onPick,
  placeholder,
  onCreate,
  createLabel,
  isLoading = false,
  isCreating = false,
  autoFocus = false,
  emptyText = 'No matches.',
  ariaLabel,
}: {
  options: SearchOption[]
  onPick: (id: string) => void
  placeholder: string
  /** Offered as the last row when the search text isn't an exact match. */
  onCreate?: (text: string) => void
  createLabel?: (text: string) => string
  isLoading?: boolean
  isCreating?: boolean
  autoFocus?: boolean
  emptyText?: string
  ariaLabel?: string
}) {
  const listId = useId()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(autoFocus)
  const [active, setActive] = useState(0)

  const term = q.trim().toLowerCase()
  const matches = useMemo(
    () => (term ? options.filter((o) => o.label.toLowerCase().includes(term) || o.sub?.toLowerCase().includes(term)) : options).slice(0, MAX_SHOWN),
    [options, term],
  )
  const canCreate = !!onCreate && !!term && !options.some((o) => o.label.toLowerCase() === term)
  const rows = matches.length + (canCreate ? 1 : 0)

  const pick = (index: number) => {
    if (index < matches.length) {
      onPick(matches[index]!.id)
      setQ('')
      setActive(0)
    } else if (canCreate) {
      onCreate!(q.trim())
      setQ('')
    }
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          role="combobox"
          aria-label={ariaLabel ?? placeholder}
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && rows > 0 ? `${listId}-${active}` : undefined}
          autoFocus={autoFocus}
          value={q}
          placeholder={placeholder}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((i) => (rows ? (i + 1) % rows : 0))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => (rows ? (i - 1 + rows) % rows : 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (open && rows > 0) pick(active)
            } else if (e.key === 'Escape' && open) {
              // Close the list, not the dialog around it.
              e.stopPropagation()
              setOpen(false)
            }
          }}
          className="w-full pl-9 pr-9 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        {(isLoading || isCreating) && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2" />
        )}
      </div>
      {open && (
        <ul id={listId} role="listbox" className="max-h-56 overflow-y-auto border border-border rounded-lg bg-card divide-y divide-border/60">
          {matches.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keep focus in the input so the list doesn't close before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
              className={`px-3 py-2 cursor-pointer text-sm ${i === active ? 'bg-accent/10' : ''}`}
            >
              <span className="block truncate text-foreground">{o.label}</span>
              {o.sub && <span className="block truncate text-xs text-muted-foreground">{o.sub}</span>}
            </li>
          ))}
          {canCreate && (
            <li
              id={`${listId}-${matches.length}`}
              role="option"
              aria-selected={active === matches.length}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(matches.length)}
              onClick={() => pick(matches.length)}
              className={`px-3 py-2 cursor-pointer text-sm flex items-center gap-2 text-accent ${active === matches.length ? 'bg-accent/10' : ''}`}
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{createLabel ? createLabel(q.trim()) : `Create "${q.trim()}"`}</span>
            </li>
          )}
          {rows === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{isLoading ? 'Loading…' : emptyText}</li>}
        </ul>
      )}
    </div>
  )
}
