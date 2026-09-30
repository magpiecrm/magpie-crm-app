import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Building2, Pencil, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { FIELD_CLASS, parseHeadcount } from '../forms'
import type { Company } from '../types'
import { Select } from '../../../components/ui/Select'

export type CompanyChanges = Partial<Pick<Company, 'name' | 'domain' | 'industry' | 'headcount' | 'owner' | 'notes'>>

/**
 * Text that turns into an input when clicked, saving on Enter or blur and
 * cancelling on Escape. Shows the server's error under it when a save fails.
 */
function EditableText({
  value,
  placeholder,
  label,
  onSave,
  className = '',
  inputClassName = '',
  inputMode,
}: {
  value: string
  placeholder: string
  label: string
  onSave: (next: string) => Promise<unknown>
  className?: string
  inputClassName?: string
  inputMode?: 'numeric'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  // Enter and the blur that follows it both commit; only the first one counts.
  const committing = useRef(false)
  const commit = async () => {
    if (committing.current) return
    if (draft.trim() === value.trim()) {
      setEditing(false)
      setError(null)
      return
    }
    committing.current = true
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
      committing.current = false
    }
  }

  return (
    <div className={`min-w-0 ${className}`}>
      {editing ? (
        <input
          autoFocus
          aria-label={label}
          value={draft}
          inputMode={inputMode}
          readOnly={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit()
            if (e.key === 'Escape') {
              setDraft(value)
              setEditing(false)
              setError(null)
            }
          }}
          className={`${FIELD_CLASS} ${inputClassName}`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label.toLowerCase()}`}
          className="group inline-flex items-center gap-1.5 max-w-full text-left rounded-md-xs -mx-1 px-1 hover:bg-muted transition-colors cursor-text"
        >
          <span className={`truncate ${value ? '' : 'text-muted-foreground'}`}>{value || placeholder}</span>
          <Pencil className="w-3 h-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" />
        </button>
      )}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground block text-xs mb-0.5">{label}</span>
      <div className="text-sm font-semibold text-foreground">{children}</div>
    </div>
  )
}

/**
 * The company page's header: its name and details, each editable in place,
 * and a delete button that asks first. Its contacts and deals stay when it's deleted.
 */
export function CompanyHeader({
  company,
  owners,
  onSave,
  onDelete,
  deleting,
  deleteError,
}: {
  company: Company
  owners: string[]
  onSave: (changes: CompanyChanges) => Promise<unknown>
  onDelete: () => void
  deleting: boolean
  deleteError: string | null
}) {
  const [confirming, setConfirming] = useState(false)
  const [ownerError, setOwnerError] = useState<string | null>(null)
  // An owner who is no longer a user still shows.
  const ownerOptions = company.owner && !owners.includes(company.owner) ? [company.owner, ...owners] : owners

  return (
    <div className="bg-card border border-border rounded-xl p-5 sm:p-6 flex flex-col gap-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          <span className="p-3 rounded-xl bg-accent/10 text-accent shrink-0">
            <Building2 className="w-6 h-6" />
          </span>
          <div className="min-w-0 flex-1">
            <EditableText
              label="Name"
              value={company.name}
              placeholder="Name"
              className="text-2xl font-bold text-foreground tracking-tight"
              inputClassName="text-xl font-bold"
              onSave={(name) => {
                if (!name.trim()) return Promise.reject(new Error('Give the company a name.'))
                return onSave({ name: name.trim() })
              }}
            />
            <EditableText
              label="Domain"
              value={company.domain ?? ''}
              placeholder="Add a website domain"
              className="text-sm text-muted-foreground mt-0.5"
              onSave={(domain) => onSave({ domain: domain.trim() || null })}
            />
          </div>
        </div>

        <div className="shrink-0 flex flex-col items-start sm:items-end gap-1">
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-foreground">Delete this company? Its contacts and deals stay.</span>
              <Button variant="danger" size="sm" isLoading={deleting} onClick={onDelete}>
                Delete
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" leftIcon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setConfirming(true)}>
              Delete company
            </Button>
          )}
          {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-3 pt-4 border-t border-border/60">
        <Field label="Industry">
          <EditableText
            label="Industry"
            value={company.industry ?? ''}
            placeholder="Add"
            onSave={(industry) => onSave({ industry: industry.trim() || null })}
          />
        </Field>
        <Field label="Staff">
          <EditableText
            label="Staff"
            inputMode="numeric"
            value={company.headcount === null ? '' : company.headcount.toLocaleString()}
            placeholder="Add"
            onSave={(raw) => onSave({ headcount: parseHeadcount(raw) })}
          />
        </Field>
        <Field label="Owner">
          <Select
            aria-label="Owner"
            value={company.owner ?? ''}
            onChange={(e) => {
              setOwnerError(null)
              onSave({ owner: e.target.value || null }).catch((err: Error) => setOwnerError(err.message))
            }}
            className={`${FIELD_CLASS} py-1.5 font-normal`}
          >
            <option value="">No owner</option>
            {ownerOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
          {ownerError && <p className="text-xs text-destructive mt-1 font-normal">{ownerError}</p>}
        </Field>
      </div>
    </div>
  )
}

/** The company's "About" notes: a textarea that saves when you click away. */
export function CompanyAbout({ notes, onSave }: { notes: string; onSave: (notes: string) => Promise<unknown> }) {
  const [draft, setDraft] = useState(notes)
  const [state, setState] = useState<{ saving?: boolean; saved?: boolean; error?: string }>({})
  // Saved notes arriving from the server replace the draft, but not while it's being typed in.
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(notes)
  }, [notes])

  return (
    <div className="space-y-1.5">
      <textarea
        aria-label="About"
        value={draft}
        rows={4}
        placeholder="What they do, who to talk to, anything worth remembering."
        onFocus={() => {
          focused.current = true
          setState({})
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false
          if (draft === notes) return
          setState({ saving: true })
          onSave(draft).then(
            () => setState({ saved: true }),
            (err: Error) => setState({ error: err.message }),
          )
        }}
        className={`${FIELD_CLASS} resize-y`}
      />
      <p className={`text-xs ${state.error ? 'text-destructive' : 'text-muted-foreground'}`} aria-live="polite">
        {state.error ?? (state.saving ? 'Saving…' : state.saved ? 'Saved' : 'Saves when you click away.')}
      </p>
    </div>
  )
}
