import { useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowDown, ArrowUp, BellOff, ExternalLink, HelpCircle, Mail, Plus } from 'lucide-react'
import { Avatar } from '../../../components/ui/Avatar'
import { getPersonasFn, setContactCustomFn } from '../../../server/functions'
import { queryKeys } from '../../../queryKeys'
import { columnLabel, formatCellValue, PINNED_COLUMN } from '../contactColumns'
import { patchContactCustom } from '../contactCache'
import type { ContactCustomValue, ContactFieldDef } from '../contactFields'
import type { ContactSort } from '../contactFilters'
import { CustomFieldInput } from './CustomFieldInput'

/** A contact as the contacts pages have them (contactForPage). */
export interface TableContact {
  email: string
  status: string
  createdAt: string
  attributes: { FIRSTNAME: string; LASTNAME: string; JOB_TITLE: string; COMPANY: string }
  custom: Record<string, ContactCustomValue>
  companyId: string | null
  linkedinUrl: string
  country: string
  personaId?: string
}

const addedOn = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })

const nameOf = (c: TableContact) => `${c.attributes.FIRSTNAME} ${c.attributes.LASTNAME}`.trim() || c.email

const UNSORTABLE = ['blocklisted', 'persona']

const fieldOf = (id: string, fields: ContactFieldDef[]) => (id.startsWith('custom:') ? fields.find((f) => `custom:${f.key}` === id) : undefined)

/**
 * The table of contacts on the Contacts page and a list's page, with the
 * columns the workspace chose: a table from md up, cards below. Sticky
 * cells need solid colours, so they can't use the row's translucent hover.
 */
export function ContactTable({
  columns,
  fields,
  rows,
  isLoading,
  empty,
  sort,
  onSort,
  onRowClick,
  selection,
  rowActions,
  onAddColumn,
}: {
  columns: string[]
  fields: ContactFieldDef[]
  rows: TableContact[]
  isLoading: boolean
  empty: string
  sort: ContactSort | null
  onSort: (sort: ContactSort | null) => void
  onRowClick?: (email: string) => void
  selection?: { selected: string[]; onChange: (emails: string[]) => void }
  rowActions?: (contact: TableContact) => ReactNode
  onAddColumn?: () => void
}) {
  const extras = (selection ? 1 : 0) + (rowActions || onAddColumn ? 1 : 0)
  const colSpan = columns.length + extras
  const selected = selection?.selected ?? []
  const onPage = rows.map((c) => c.email)
  const allSelected = rows.length > 0 && onPage.every((e) => selected.includes(e))
  const someSelected = !allSelected && onPage.some((e) => selected.includes(e))
  // Both on show means there's no need to say them again under the name.
  const roleInContact = !(columns.includes('company') && columns.includes('job_title'))

  const toggle = (email: string, on: boolean) => selection?.onChange(on ? [...selected, email] : selected.filter((e) => e !== email))
  const toggleAll = (on: boolean) => selection?.onChange(on ? [...new Set([...selected, ...onPage])] : selected.filter((e) => !onPage.includes(e)))
  const nextSort = (column: string) => {
    if (sort?.column !== column) onSort({ column, dir: 'asc' })
    else onSort(sort.dir === 'asc' ? { column, dir: 'desc' } : null)
  }
  const stickyLeft = selection ? 'md:left-14' : 'md:left-0'
  const customOnCards = columns.filter((id) => id.startsWith('custom:')).slice(0, 3)

  return (
    <div className="bg-card border border-border overflow-hidden shadow-sm">
      <ul className="md:hidden divide-y divide-border">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="p-4 animate-pulse">
              <div className="h-6 bg-muted rounded w-full" />
            </li>
          ))
        ) : rows.length === 0 ? (
          <li className="p-8 text-center text-muted-foreground text-sm">{empty}</li>
        ) : (
          rows.map((contact) => {
            const fullName = nameOf(contact)
            return (
              <li key={contact.email} onClick={() => onRowClick?.(contact.email)} className={`p-4 flex items-start gap-3 transition-colors ${onRowClick ? 'active:bg-muted/40 cursor-pointer' : ''}`}>
                {selection && (
                  <label onClick={(e) => e.stopPropagation()} className="touch-target flex items-center justify-center shrink-0 -m-2 p-2">
                    <input type="checkbox" checked={selected.includes(contact.email)} onChange={(e) => toggle(contact.email, e.target.checked)} className="w-4 h-4 rounded border-border text-accent focus:ring-accent cursor-pointer accent-accent" />
                  </label>
                )}
                <Avatar name={fullName} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">{fullName}</p>
                  <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                  <Role contact={contact} className="text-xs text-muted-foreground truncate" />
                  {(columns.includes('status') || columns.includes('created_at')) && (
                    <div className="flex items-center gap-2 mt-1.5">
                      {columns.includes('status') && <SubscriptionBadge status={contact.status} />}
                      {columns.includes('created_at') && <span className="text-[10px] text-muted-foreground font-medium">{addedOn(contact.createdAt)}</span>}
                    </div>
                  )}
                  {customOnCards.map((id) => {
                    const field = fieldOf(id, fields)!
                    const shown = formatCellValue(contact.custom[field.key], field)
                    return (
                      shown && (
                        <p key={id} className="text-xs text-muted-foreground truncate mt-1">
                          {field.label}: <span className="text-foreground">{shown}</span>
                        </p>
                      )
                    )
                  })}
                </div>
                {rowActions && <div className="shrink-0">{rowActions(contact)}</div>}
              </li>
            )
          })
        )}
      </ul>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {selection && (
                <th className="sticky left-0 z-10 w-14 min-w-14 bg-card pl-6 pr-2 py-4">
                  <input
                    type="checkbox"
                    aria-label="Select everyone on this page"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected
                    }}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-accent focus:ring-accent cursor-pointer accent-accent"
                  />
                </th>
              )}
              {columns.map((id) => {
                const pinned = id === PINNED_COLUMN
                const label = columnLabel(id, fields) ?? id
                const sorted = sort?.column === id ? sort.dir : null
                return (
                  <th key={id} aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined} className={`px-6 py-4 whitespace-nowrap ${pinned ? `sticky ${stickyLeft} z-10 bg-card` : ''}`}>
                    {UNSORTABLE.includes(id) ? (
                      label
                    ) : (
                      <button type="button" onClick={() => nextSort(id)} className="inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-foreground cursor-pointer">
                        {label}
                        {sorted === 'asc' && <ArrowUp className="w-3 h-3" />}
                        {sorted === 'desc' && <ArrowDown className="w-3 h-3" />}
                      </button>
                    )}
                  </th>
                )
              })}
              {(rowActions || onAddColumn) && (
                <th className="pr-4 py-4 w-12">
                  {onAddColumn && (
                    <button type="button" onClick={onAddColumn} aria-label="Add column" title="Add column" className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer">
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-sm">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td colSpan={colSpan} className="px-6 py-7">
                    <div className="h-6 bg-muted rounded w-full" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-6 py-12 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((contact) => (
                <tr key={contact.email} className={`group hover:bg-muted/30 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`} onClick={() => onRowClick?.(contact.email)}>
                  {selection && (
                    <td className="sticky left-0 z-10 bg-card group-hover:bg-muted pl-6 pr-2 py-4" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${contact.email}`} checked={selected.includes(contact.email)} onChange={(e) => toggle(contact.email, e.target.checked)} className="w-4 h-4 rounded border-border text-accent focus:ring-accent cursor-pointer accent-accent" />
                    </td>
                  )}
                  {columns.map((id) =>
                    id === PINNED_COLUMN ? (
                      <td key={id} className={`sticky ${stickyLeft} z-10 bg-card group-hover:bg-muted px-6 py-4`}>
                        <ContactCell contact={contact} withRole={roleInContact} />
                      </td>
                    ) : (
                      <Cell key={id} id={id} contact={contact} fields={fields} />
                    ),
                  )}
                  {(rowActions || onAddColumn) && <td className="pr-4 py-4">{rowActions?.(contact)}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ContactCell({ contact, withRole }: { contact: TableContact; withRole: boolean }) {
  const fullName = nameOf(contact)
  return (
    <div className="flex items-center gap-3">
      <Avatar name={fullName} />
      <div className="min-w-0">
        <p className="font-semibold text-foreground flex items-center gap-1.5 whitespace-nowrap">
          {fullName}
          {contact.linkedinUrl && (
            <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`${fullName} on LinkedIn`} title="Open their LinkedIn profile" className="text-muted-foreground hover:text-accent">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </p>
        {withRole && <Role contact={contact} className="text-xs text-muted-foreground max-w-[260px] truncate" />}
      </div>
    </div>
  )
}

function Role({ contact, className }: { contact: TableContact; className: string }) {
  const { JOB_TITLE, COMPANY } = contact.attributes
  if (!JOB_TITLE && !COMPANY) return null
  return (
    <p className={className}>
      {JOB_TITLE}
      {JOB_TITLE && COMPANY && ' at '}
      <CompanyName name={COMPANY} companyId={contact.companyId} />
    </p>
  )
}

/** The contact's company name, linking to its company page when it has one. */
function CompanyName({ name, companyId }: { name: string; companyId: string | null }) {
  if (!name || !companyId) return <>{name}</>
  return (
    <Link to="/marketing/companies/$id" params={{ id: companyId }} onClick={(e) => e.stopPropagation()} className="hover:text-accent hover:underline">
      {name}
    </Link>
  )
}

function Cell({ id, contact, fields }: { id: string; contact: TableContact; fields: ContactFieldDef[] }) {
  const field = fieldOf(id, fields)
  if (field) return <CustomCell field={field} contact={contact} />
  switch (id) {
    case 'status':
      return (
        <td className="px-6 py-4">
          <SubscriptionBadge status={contact.status} />
        </td>
      )
    case 'email':
      return <td className="px-6 py-4 font-medium text-foreground whitespace-nowrap">{contact.email}</td>
    case 'country':
      return <td className="px-6 py-4 text-muted-foreground">{contact.country || '—'}</td>
    case 'company':
      return (
        <td className="px-6 py-4 text-foreground">
          {contact.attributes.COMPANY ? <CompanyName name={contact.attributes.COMPANY} companyId={contact.companyId} /> : <span className="text-muted-foreground">—</span>}
        </td>
      )
    case 'job_title':
      return <td className="px-6 py-4 text-foreground">{contact.attributes.JOB_TITLE || <span className="text-muted-foreground">—</span>}</td>
    case 'created_at':
      return <td className="px-6 py-4 text-xs text-muted-foreground font-medium whitespace-nowrap">{addedOn(contact.createdAt)}</td>
    case 'persona':
      return <PersonaCell id={contact.personaId} />
    default:
      return <td className="px-6 py-4 text-muted-foreground">—</td>
  }
}

/** The persona applied in the search that found them, by its name now. */
function PersonaCell({ id }: { id?: string }) {
  const { data: personas = [] } = useQuery({ queryKey: queryKeys.prospects.personas(), queryFn: () => getPersonasFn(), enabled: Boolean(id) })
  const name = id ? personas.find((p) => p.id === id)?.name : undefined
  return <td className="px-6 py-4 text-foreground">{name ?? <span className="text-muted-foreground">—</span>}</td>
}

/** A custom value, which a click edits in place (not a multi select: its chips want more room than a cell has). */
function CustomCell({ field, contact }: { field: ContactFieldDef; contact: TableContact }) {
  const queryClient = useQueryClient()
  const saved = contact.custom[field.key]
  const [draft, setDraft] = useState<ContactCustomValue | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [problem, setProblem] = useState('')
  const cancelled = useRef(false)
  const shown = formatCellValue(saved, field)

  const commit = async (value: ContactCustomValue | undefined) => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const before = contact.custom
    if (JSON.stringify(value ?? null) === JSON.stringify(saved ?? null)) return setEditing(false)
    const { [field.key]: _, ...rest } = before
    patchContactCustom(queryClient, contact.email, value === null || value === '' || value === undefined ? rest : { ...before, [field.key]: value })
    setEditing(false)
    setProblem('')
    try {
      const result = await setContactCustomFn({ data: { email: contact.email, values: { [field.key]: value ?? null } } })
      patchContactCustom(queryClient, contact.email, result.custom)
      if (result.problems.length) {
        setProblem(result.problems[0])
        setDraft(value)
        setEditing(true)
      }
    } catch (err: any) {
      patchContactCustom(queryClient, contact.email, before)
      setProblem(err?.message ?? "That didn't save.")
    }
  }

  if (field.type === 'multiselect') {
    return (
      <td className="px-6 py-4 text-foreground max-w-[220px] truncate" title={shown}>
        {shown || <span className="text-muted-foreground">—</span>}
      </td>
    )
  }

  if (editing) {
    const choosesAtOnce = field.type === 'select' || field.type === 'boolean'
    return (
      <td
        className="px-3 py-2 min-w-[160px]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            cancelled.current = !choosesAtOnce
            setEditing(false)
            setProblem('')
          }
        }}
      >
        <CustomFieldInput
          compact
          autoFocus
          field={field}
          value={draft}
          saved={saved}
          ariaLabel={`${field.label} for ${contact.email}`}
          onChange={(value) => {
            setDraft(value)
            if (choosesAtOnce) void commit(value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit(draft)
          }}
          onBlur={() => (choosesAtOnce ? setEditing(false) : void commit(draft))}
        />
        {problem && <p className="mt-1 text-xs text-destructive">{problem}</p>}
      </td>
    )
  }

  return (
    <td className="px-6 py-4 text-foreground max-w-[220px]" title={problem || shown}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          cancelled.current = false
          setDraft(saved ?? null)
          setEditing(true)
        }}
        aria-label={`Edit ${field.label} for ${contact.email}`}
        className="block w-full truncate text-left cursor-text rounded hover:ring-1 hover:ring-border"
      >
        {shown || <span className="text-muted-foreground">—</span>}
      </button>
      {problem && <p className="mt-1 text-xs text-destructive">{problem}</p>}
    </td>
  )
}

// Reflects `contacts.status` from the DB. Campaign sends select
// `status = 'subscribed'`, so anything else is excluded, and an unsubscribed or
// bounced contact showing as subscribed hides why a campaign sent to nobody.
function SubscriptionBadge({ status }: { status?: string }) {
  const styles = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap'

  switch (status) {
    case 'subscribed':
      return (
        <span className={`${styles} bg-emerald-500/10 text-emerald-600 border-emerald-500/10`}>
          <Mail className="w-3 h-3" />
          Subscribed
        </span>
      )
    case 'unsubscribed':
      return (
        <span className={`${styles} bg-amber-500/10 text-amber-600 border-amber-500/10`}>
          <BellOff className="w-3 h-3" />
          Unsubscribed
        </span>
      )
    case 'bounced':
      return (
        <span className={`${styles} bg-red-500/10 text-red-600 border-red-500/10`}>
          <AlertTriangle className="w-3 h-3" />
          Bounced
        </span>
      )
    default:
      // Never silently render an unknown status as subscribed.
      return (
        <span className={`${styles} bg-muted text-muted-foreground border-border`}>
          <HelpCircle className="w-3 h-3" />
          {status || 'Unknown'}
        </span>
      )
  }
}
