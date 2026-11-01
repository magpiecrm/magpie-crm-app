import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus, Search, X } from 'lucide-react'
import { Select } from '../../../components/ui/Select'
import { OPERATORS, isComplete, newFilter, type ContactFilter, type FilterFieldInfo } from '../contactFilters'

const CONTROL = 'px-2.5 py-1.5 border border-border rounded-lg bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-accent'

/** The "Add filter" button and its menu of fields. */
export function AddFilterButton({ fields, onAdd, open, onOpenChange }: { fields: FilterFieldInfo[]; onAdd: (field: FilterFieldInfo) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    search.current?.focus()
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onOpenChange(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open, onOpenChange])

  const shown = useMemo(() => fields.filter((f) => f.label.toLowerCase().includes(query.trim().toLowerCase())), [fields, query])

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 px-3 py-2 border border-border rounded-xl text-sm font-medium hover:bg-muted/40 transition-colors bg-card text-foreground cursor-pointer"
      >
        <Plus className="w-4 h-4 opacity-75" />
        <span>Add filter</span>
        <ChevronDown className="w-4 h-4 opacity-75" />
      </button>
      {open && (
        <div role="menu" aria-label="Filter by" className="absolute left-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-lg z-20 py-1">
          <div className="relative px-2 pt-1 pb-2 border-b border-border/60">
            <Search className="absolute left-4.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a field"
              aria-label="Find a field"
              className="w-full pl-8 pr-2 py-1.5 border border-border rounded-lg bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <p className="px-4 py-2 text-xs text-muted-foreground">No field by that name.</p>
            ) : (
              shown.map((field) => (
                <button
                  key={field.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onAdd(field)
                    onOpenChange(false)
                  }}
                  className="w-full text-left px-4 py-2 hover:bg-muted/50 text-sm cursor-pointer"
                >
                  {field.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** A filter's several values as chips, picked from the field's options or typed. */
function ValuesInput({ filter, field, onChange }: { filter: ContactFilter; field: FilterFieldInfo; onChange: (next: ContactFilter) => void }) {
  const [draft, setDraft] = useState('')
  const values = filter.values ?? []
  const labelOf = (value: string) => field.options?.find((o) => o.value === value)?.label ?? value

  const add = (text: string) => {
    const typed = text.split(',').map((v) => v.trim()).filter(Boolean)
    const fresh = typed.filter((v, i) => typed.indexOf(v) === i && !values.some((x) => x.toLowerCase() === v.toLowerCase()))
    if (fresh.length) onChange({ ...filter, values: [...values, ...fresh] })
    setDraft('')
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {values.map((value) => (
        <span key={value} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg bg-accent/10 text-foreground text-xs">
          {labelOf(value)}
          <button
            type="button"
            onClick={() => onChange({ ...filter, values: values.filter((v) => v !== value) })}
            aria-label={`Remove ${labelOf(value)}`}
            className="rounded text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      {field.kind === 'choice' ? (
        <Select value="" onChange={(e) => add(e.target.value)} aria-label={`Add a ${field.label} value`} className={CONTROL}>
          <option value="">Add…</option>
          {(field.options ?? [])
            .filter((o) => !values.includes(o.value))
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
        </Select>
      ) : (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && values.length) {
              onChange({ ...filter, values: values.slice(0, -1) })
            }
          }}
          onBlur={() => add(draft)}
          placeholder={values.length ? 'Add another' : 'Type, then Enter'}
          aria-label={`${field.label} values`}
          autoFocus={values.length === 0}
          className={`${CONTROL} w-32`}
        />
      )}
    </div>
  )
}

/** One filter: its field, how it's compared, and what with. */
function FilterRow({ filter, field, onChange, onRemove }: { filter: ContactFilter; field: FilterFieldInfo; onChange: (next: ContactFilter) => void; onRemove: () => void }) {
  const operators = OPERATORS[field.kind]
  const operator = operators.find((o) => o.op === filter.op) ?? operators[0]
  const waiting = !isComplete(filter, field)

  // What's been entered carries across to a comparison taking one value or several.
  const compareBy = (op: ContactFilter['op']) => {
    const multi = operators.find((o) => o.op === op)?.multi
    if (multi && !operator.multi) return onChange({ ...filter, op, value: '', values: filter.value.trim() ? [filter.value.trim()] : [] })
    if (!multi && operator.multi) return onChange({ ...filter, op, value: filter.values?.[0] ?? '', values: undefined })
    onChange({ ...filter, op })
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 pl-3 pr-1.5 py-1 border rounded-xl bg-card ${waiting ? 'border-dashed border-border' : 'border-accent/30 bg-accent/5'}`}>
      <span className="text-xs font-semibold text-foreground whitespace-nowrap">{field.label}</span>
      <Select
        value={operator.op}
        onChange={(e) => compareBy(e.target.value as ContactFilter['op'])}
        aria-label={`How to compare ${field.label}`}
        className={CONTROL}
      >
        {operators.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </Select>
      {operator.multi ? (
        <ValuesInput filter={filter} field={field} onChange={onChange} />
      ) : !operator.valueless &&
        (field.kind === 'choice' ? (
          <Select value={filter.value} onChange={(e) => onChange({ ...filter, value: e.target.value })} aria-label={`${field.label} value`} className={CONTROL}>
            <option value="">Choose…</option>
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : (
          <input
            type={field.kind === 'date' ? 'date' : field.kind === 'number' || field.kind === 'activity' ? 'number' : 'text'}
            value={filter.value}
            onChange={(e) => onChange({ ...filter, value: e.target.value })}
            placeholder={field.kind === 'text' ? 'Type to filter' : undefined}
            aria-label={`${field.label} value`}
            autoFocus={filter.value === ''}
            className={`${CONTROL} ${field.kind === 'text' ? 'w-40' : field.kind === 'activity' ? 'w-16' : 'w-32'}`}
          />
        ))}
      {field.kind === 'activity' && <span className="text-xs text-muted-foreground">days</span>}
      <button type="button" onClick={onRemove} aria-label={`Remove the ${field.label} filter`} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

/** The filters in use, each editable, with a way to clear them all. */
export function ActiveFilters({ filters, fields, onChange }: { filters: ContactFilter[]; fields: FilterFieldInfo[]; onChange: (next: ContactFilter[]) => void }) {
  if (filters.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4" aria-label="Filters in use">
      {filters.map((filter) => {
        const field = fields.find((f) => f.key === filter.field)
        if (!field) return null
        return (
          <FilterRow
            key={filter.id}
            filter={filter}
            field={field}
            onChange={(next) => onChange(filters.map((f) => (f.id === filter.id ? next : f)))}
            onRemove={() => onChange(filters.filter((f) => f.id !== filter.id))}
          />
        )
      })}
      <button type="button" onClick={() => onChange([])} className="px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer">
        Clear all
      </button>
    </div>
  )
}

export { newFilter }
