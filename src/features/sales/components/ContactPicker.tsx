import { useMemo } from 'react'
import { X } from 'lucide-react'
import { SearchSelect } from './SearchSelect'
import { useContactOptions } from './useSalesLookups'

/** Search the contacts and pick one, leaving out those in `exclude`. */
export function ContactSearch({
  exclude = [],
  onPick,
  autoFocus,
}: {
  exclude?: string[]
  onPick: (email: string) => void
  autoFocus?: boolean
}) {
  const { data: contacts = [], isLoading } = useContactOptions()
  const options = useMemo(() => {
    const skip = new Set(exclude)
    return contacts
      .filter((c) => !skip.has(c.email))
      .map((c) => ({ id: c.email, label: c.name ?? c.email, sub: c.name ? [c.email, c.company].filter(Boolean).join(' · ') : c.company }))
  }, [contacts, exclude])

  return (
    <SearchSelect
      options={options}
      onPick={onPick}
      placeholder="Search contacts"
      isLoading={isLoading}
      autoFocus={autoFocus}
      emptyText={contacts.length === 0 && !isLoading ? 'No contacts yet.' : 'No contacts match.'}
    />
  )
}

/** Several contacts: the chosen ones as chips, and a search to add more. */
export function ContactPicker({ value, onChange }: { value: string[]; onChange: (emails: string[]) => void }) {
  const { data: contacts = [] } = useContactOptions()
  const names = useMemo(() => new Map(contacts.map((c) => [c.email, c.name])), [contacts])

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((email) => (
            <li key={email} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-accent/10 text-accent text-xs max-w-full">
              <span className="truncate" title={email}>
                {names.get(email) ?? email}
              </span>
              <button
                type="button"
                onClick={() => onChange(value.filter((e) => e !== email))}
                aria-label={`Remove ${email}`}
                className="p-0.5 rounded-full hover:bg-accent/20 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ContactSearch exclude={value} onPick={(email) => onChange([...value, email])} />
    </div>
  )
}
