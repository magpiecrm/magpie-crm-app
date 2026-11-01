import { INPUT_CLASS } from '../../../components/ui/Field'
import { Select } from '../../../components/ui/Select'
import type { ContactCustomValue, ContactFieldDef } from '../contactFields'

/**
 * The input for one custom field, everywhere a value is entered. `value` is
 * what's been typed so far; `saved` is what the contact has, which keeps a
 * choice on offer after it's been removed from the field's options, marked so.
 */
export function CustomFieldInput({
  field,
  value,
  saved,
  onChange,
  ariaLabel,
  compact,
  autoFocus,
  onKeyDown,
  onBlur,
}: {
  field: ContactFieldDef
  value: ContactCustomValue | undefined
  saved?: ContactCustomValue
  onChange: (value: ContactCustomValue) => void
  ariaLabel: string
  /** In a table cell. */
  compact?: boolean
  autoFocus?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onBlur?: () => void
}) {
  const className = compact ? `${INPUT_CLASS} !min-h-8 !py-1` : INPUT_CLASS
  const text = value === null || value === undefined ? '' : String(value)
  const input = { 'aria-label': ariaLabel, className, autoFocus, onKeyDown, onBlur }

  switch (field.type) {
    case 'text':
      return <input {...input} type="text" value={text} onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return <input {...input} type="text" inputMode="decimal" value={text} onChange={(e) => onChange(e.target.value)} />
    case 'date':
      return <input {...input} type="date" value={text.slice(0, 10)} onChange={(e) => onChange(e.target.value)} />
    case 'boolean':
      return (
        // Blank isn't No: a filter on "is no" and a merge tag both tell them apart.
        <Select className={className} aria-label={ariaLabel} value={value === true ? 'yes' : value === false ? 'no' : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}>
          <option value="">—</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      )
    case 'select': {
      const options = field.options ?? []
      const removed = typeof saved === 'string' && !options.includes(saved) ? saved : null
      return (
        <Select className={className} aria-label={ariaLabel} value={text} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {removed && <option value={removed}>{removed} (removed)</option>}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      )
    }
    case 'multiselect': {
      const chosen = Array.isArray(value) ? value : []
      const options = field.options ?? []
      const removed = (Array.isArray(saved) ? saved : []).filter((o) => !options.includes(o))
      const toggle = (option: string) => onChange(chosen.includes(option) ? chosen.filter((o) => o !== option) : [...chosen, option])
      return (
        <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
          {[...removed, ...options].map((option) => {
            const on = chosen.includes(option)
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(option)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${on ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {option}
                {removed.includes(option) ? ' (removed)' : ''}
              </button>
            )
          })}
        </div>
      )
    }
  }
}
