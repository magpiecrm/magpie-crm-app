import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlignLeft, ArrowDown, ArrowUp, AtSign, Briefcase, Building2, Calendar, Check, ChevronDown, GripVertical, Hash, List, ListChecks, Lock, Monitor, Plus, ShieldCheck,
  Info, Palette, Send, Smartphone, SquareCheck, Trash2, Type, User,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Select } from '../../../components/ui/Select'
import { Switch } from '../../../components/ui/Switch'
import { ActionMenu, type ActionMenuItem } from '../../../components/ui/ActionMenu'
import { Dialog } from '../../../components/ui/Dialog'
import { ContactFieldForm } from '../../contacts/components/ContactFieldForm'
import { invalidateContactFields } from '../../contacts/contactCache'
import { createListFn } from '../../../server/functions'
import type { FormInput } from '../../../server/functions/forms'
import { queryKeys } from '../../../queryKeys'
import type { ContactFieldDef } from '../../contacts/contactFields'
import {
  BUILTIN_FORM_FIELDS, BUILTIN_LABELS, DEFAULT_ACCENT, DEFAULT_SUBMIT_LABEL, DEFAULT_SUCCESS_MESSAGE, customKey,
  publicForm, resolveFields, type FormCorners, type FormRecord, type ResolvedFormField,
} from '../model'
import { FormView } from './FormView'
import { textOn } from '../render'
import { delayLabel } from '../format'

export type FormDraft = Required<Pick<FormInput, 'name' | 'fields' | 'list_id' | 'save_to_list_enabled' | 'save_to_list_fields' | 'welcome_email_enabled' | 'welcome_email_subject' | 'welcome_email_body' | 'welcome_email_delay_minutes' | 'sender_id'>> &
  Pick<FormInput, 'field_settings' | 'submit_label' | 'success_message' | 'style'>

export const NEW_FORM: FormDraft = {
  name: '',
  fields: ['first_name', 'last_name', 'email', 'company', 'message'],
  field_settings: {},
  list_id: 1,
  save_to_list_enabled: true,
  save_to_list_fields: ['first_name', 'last_name', 'company', 'job_title'],
  welcome_email_enabled: false,
  welcome_email_subject: 'Thanks for getting in touch',
  welcome_email_body: 'Hi {{first_name}},\n\nThanks for getting in touch. Someone from our team will reply shortly.\n\nBest wishes,',
  welcome_email_delay_minutes: 5,
  sender_id: null,
  submit_label: DEFAULT_SUBMIT_LABEL,
  success_message: DEFAULT_SUCCESS_MESSAGE,
  style: {},
}

/** A stored form as the builder edits it, with what older forms lack filled in. */
export function draftOf(form: FormRecord): FormDraft {
  return {
    name: form.name,
    fields: form.fields.includes('email') ? form.fields : ['email', ...form.fields],
    field_settings: form.field_settings ?? {},
    list_id: form.list_id,
    save_to_list_enabled: form.save_to_list_enabled ?? true,
    save_to_list_fields: form.save_to_list_fields ?? ['first_name', 'last_name', 'company'],
    welcome_email_enabled: form.welcome_email_enabled,
    welcome_email_subject: form.welcome_email_subject,
    welcome_email_body: form.welcome_email_body,
    welcome_email_delay_minutes: form.welcome_email_delay_minutes,
    sender_id: form.sender_id,
    submit_label: form.submit_label || DEFAULT_SUBMIT_LABEL,
    success_message: form.success_message || DEFAULT_SUCCESS_MESSAGE,
    style: form.style ?? {},
  }
}

const BUILTIN_ICONS: Record<string, LucideIcon> = {
  first_name: User, last_name: User, email: AtSign, company: Building2, job_title: Briefcase, message: AlignLeft, consent: ShieldCheck,
}
const TYPE_ICONS: Record<ResolvedFormField['type'], LucideIcon> = {
  text: Type, email: AtSign, textarea: AlignLeft, number: Hash, date: Calendar, checkbox: SquareCheck, select: List, multiselect: ListChecks,
}
const TYPE_NAMES: Record<ResolvedFormField['type'], string> = {
  text: 'Short text', email: 'Email', textarea: 'Long text', number: 'Number', date: 'Date', checkbox: 'Tick box', select: 'Dropdown', multiselect: 'Choices',
}
const CONTACT_TYPE_ICONS: Record<ContactFieldDef['type'], LucideIcon> = {
  text: Type, number: Hash, date: Calendar, boolean: SquareCheck, select: List, multiselect: ListChecks,
}
const iconOf = (f: ResolvedFormField) => BUILTIN_ICONS[f.key] ?? TYPE_ICONS[f.type]

type BuilderTab = 'fields' | 'after' | 'style'
const BUILDER_TABS: Array<{ id: BuilderTab; label: string; icon: LucideIcon }> = [
  { id: 'fields', label: 'Fields', icon: ListChecks },
  { id: 'after', label: 'After sending', icon: Send },
  { id: 'style', label: 'Style', icon: Palette },
]

const DELAYS = [0, 5, 15, 60, 1440]
const SWATCHES = [
  { hex: '#111827', name: 'Black' },
  { hex: '#0f766e', name: 'Teal' },
  { hex: '#2563eb', name: 'Blue' },
  { hex: '#7c3aed', name: 'Purple' },
  { hex: '#db2777', name: 'Pink' },
  { hex: '#ea580c', name: 'Orange' },
]
const CORNERS: Array<{ id: FormCorners; label: string }> = [
  { id: 'square', label: 'Square' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'pill', label: 'Pill' },
]

/** A section of the builder: a heading, a line on what it's for, then its controls. */
function Section({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 px-5 py-6 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-[17px] font-semibold leading-6 text-foreground">{title}</h2>
          {description && <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0 pt-0.5">{action}</div>}
      </div>
      {children}
    </section>
  )
}

/** Two to four choices as one segmented control. */
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ id: T; label: ReactNode }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-grid auto-cols-fr grid-flow-col gap-1 rounded-md-s bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md-xs px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
            value === o.id ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.1)] ring-1 ring-border dark:bg-white/[0.14] dark:ring-white/15' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function FieldRow({
  field,
  open,
  onToggle,
  saved,
  canSave,
  onSettings,
  onSaveToContact,
  onRemove,
  onMove,
}: {
  field: ResolvedFormField
  open: boolean
  onToggle: () => void
  saved: boolean
  canSave: boolean
  onSettings: (patch: { label?: string; placeholder?: string; required?: boolean }) => void
  onSaveToContact: (on: boolean) => void
  onRemove: () => void
  /** Up or down one place, for anyone not dragging; missing at that end of the list. */
  onMove: { up?: () => void; down?: () => void }
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key })
  const Icon = iconOf(field)
  const locked = field.key === 'email'
  const isConsent = field.key === 'consent'
  const custom = customKey(field.key) !== null
  const panelId = `field-${field.key.replace(/[^a-z0-9_-]/gi, '_')}-settings`
  return (
    <li
      id={`field-row-${field.key.replace(/[^a-z0-9_-]/gi, '_')}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`bg-card ${isDragging ? 'relative z-10 rounded-md-s shadow-md ring-1 ring-border' : ''}`}
    >
      <div className="flex min-h-[52px] items-center gap-2 py-1.5 pl-1.5 pr-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Move ${field.label}`}
          className="flex h-9 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
        >
          <GripVertical className="h-[18px] w-[18px]" />
        </button>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md-xs bg-muted text-foreground/70" title={TYPE_NAMES[field.type]}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} className="flex min-w-0 flex-1 cursor-pointer flex-col items-start rounded-md-xs px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <span className="w-full truncate text-sm font-medium text-foreground">{isConsent ? 'Consent' : field.label}</span>
          <span className="w-full truncate text-[13px] text-muted-foreground">
            {isConsent ? field.label : TYPE_NAMES[field.type]}
            {custom && ' · Contact field'}
          </span>
        </button>
        {/* One tick box in the same place on every row; Email's is ticked for good. */}
        <label
          className={`flex min-h-9 shrink-0 items-center gap-2 rounded-md-xs px-2 text-[13px] font-medium text-foreground ${locked ? 'cursor-default' : 'cursor-pointer hover:bg-muted'}`}
          title={locked ? "Every form asks for an email: it's how the person is saved" : undefined}
        >
          {locked ? <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> : null}
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={field.required}
            disabled={locked}
            onChange={(e) => onSettings({ required: e.target.checked })}
            aria-label={locked ? 'Email is always required' : `${field.label} is required`}
          />
          <span aria-hidden className={locked ? 'text-muted-foreground' : ''}>Required</span>
        </label>
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${open ? 'Hide' : 'Show'} settings for ${field.label}`}
          aria-expanded={open}
          aria-controls={panelId}
          className="shrink-0 cursor-pointer rounded-md-xs p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div id={panelId} className="flex flex-col gap-4 border-t border-border/70 bg-background/60 px-4 py-4">
          {isConsent ? (
            <Field label="Wording" hint="What they agree to. It's kept with each submission.">
              <textarea
                className={`${INPUT_CLASS} min-h-[72px] resize-y`}
                rows={2}
                value={field.label}
                onChange={(e) => onSettings({ label: e.target.value })}
              />
            </Field>
          ) : (
            <FieldGrid>
              <Field label="Label">
                <input className={INPUT_CLASS} value={field.label} onChange={(e) => onSettings({ label: e.target.value })} />
              </Field>
              {field.type !== 'checkbox' && field.type !== 'multiselect' && field.type !== 'select' && field.type !== 'date' && (
                <Field label="Placeholder" hint="Optional">
                  <input className={INPUT_CLASS} value={field.placeholder} placeholder={field.type === 'email' ? 'name@company.com' : ''} onChange={(e) => onSettings({ placeholder: e.target.value })} />
                </Field>
              )}
            </FieldGrid>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {field.contact && !locked ? (
              <label className={`flex items-center gap-2.5 text-sm ${canSave ? 'cursor-pointer text-foreground' : 'cursor-not-allowed text-muted-foreground'}`}>
                <input type="checkbox" checked={saved && canSave} disabled={!canSave} onChange={(e) => onSaveToContact(e.target.checked)} className="h-4 w-4" />
                Save to the contact
                {!canSave && <span className="text-[13px]">(turn on Add to a list)</span>}
              </label>
            ) : (
              <span className="text-[13px] text-muted-foreground">
                {locked ? 'Saved as the contact’s email.' : 'Kept with the submission.'}
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <Button variant="ghost" size="sm" onClick={onMove.up} disabled={!onMove.up} leftIcon={<ArrowUp className="h-3.5 w-3.5" />}>Move up</Button>
              <Button variant="ghost" size="sm" onClick={onMove.down} disabled={!onMove.down} leftIcon={<ArrowDown className="h-3.5 w-3.5" />}>Move down</Button>
              {!locked && (
                <Button variant="ghost" size="sm" onClick={onRemove} leftIcon={<Trash2 className="h-3.5 w-3.5" />} className="!text-destructive hover:!bg-destructive/10">
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * Making or changing a form: what it asks, what happens when it's sent, and
 * how it looks, beside a live preview of the form itself. On a phone the
 * preview is a tab of its own.
 */
export function FormBuilder({
  initial,
  isNew,
  lists,
  senders,
  contactFields,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initial: FormDraft
  isNew: boolean
  lists: Array<{ id: number; name: string }>
  senders: Array<{ id: number; name: string; email: string }>
  contactFields: ContactFieldDef[]
  saving: boolean
  error?: string
  onSave: (draft: FormDraft) => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<FormDraft>(initial)
  const [openField, setOpenField] = useState<string | null>(null)
  const [newList, setNewList] = useState<string | null>(null)
  const [addingField, setAddingField] = useState(false)
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop')
  const [pane, setPane] = useState<'edit' | 'preview'>('edit')
  const [tab, setTab] = useState<BuilderTab>('fields')
  const [previewKey, setPreviewKey] = useState(0)
  const [nameError, setNameError] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial])
  const set = (patch: Partial<FormDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const record = { ...draft, id: 'preview', created_at: '' } as FormRecord
  const fields = resolveFields(record, contactFields)
  const preview = publicForm(record, contactFields)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const move = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    setDraft((d) => ({ ...d, fields: arrayMove(d.fields, d.fields.indexOf(String(active.id)), d.fields.indexOf(String(over.id))) }))
  }

  const shift = (key: string, by: -1 | 1) =>
    setDraft((d) => {
      const at = d.fields.indexOf(key)
      return at < 0 ? d : { ...d, fields: arrayMove(d.fields, at, Math.max(0, Math.min(d.fields.length - 1, at + by))) }
    })

  const settingsFor = (key: string, patch: { label?: string; placeholder?: string; required?: boolean }) =>
    setDraft((d) => {
      const current = { ...(d.field_settings?.[key] ?? {}) }
      if (patch.label !== undefined) current.label = patch.label
      if (patch.placeholder !== undefined) current.placeholder = patch.placeholder
      if (patch.required !== undefined) current.required = patch.required
      return { ...d, field_settings: { ...d.field_settings, [key]: current } }
    })

  const addField = (key: string) => {
    setDraft((d) => ({
      ...d,
      // Consent goes last, just above the button, where people expect it.
      fields: key === 'consent' ? [...d.fields, key] : d.fields.includes('consent') ? [...d.fields.slice(0, -1), key, 'consent'].filter((k, i, a) => a.indexOf(k) === i) : [...d.fields, key],
      save_to_list_fields: key === 'message' || key === 'consent' ? d.save_to_list_fields : [...new Set([...d.save_to_list_fields, key])],
    }))
    setOpenField(key)
  }
  const removeField = (key: string) => {
    setDraft((d) => ({ ...d, fields: d.fields.filter((k) => k !== key), save_to_list_fields: d.save_to_list_fields.filter((k) => k !== key) }))
    setOpenField(null)
  }

  const createList = useMutation({
    mutationFn: (name: string) => createListFn({ data: { name } }),
    onSuccess: (list) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      set({ list_id: list.id })
      setNewList(null)
    },
  })

  const addable: ActionMenuItem[] = [
    ...BUILTIN_FORM_FIELDS.filter((k) => !draft.fields.includes(k)).map((k): ActionMenuItem => ({ label: BUILTIN_LABELS[k], icon: BUILTIN_ICONS[k], onSelect: () => addField(k) })),
  ]
  const customAddable = contactFields.filter((f) => !draft.fields.includes(`custom:${f.key}`))
  if (customAddable.length) {
    addable.push('separator')
    for (const f of customAddable) addable.push({ label: f.label, icon: CONTACT_TYPE_ICONS[f.type], onSelect: () => addField(`custom:${f.key}`) })
  }
  addable.push('separator', { label: 'New contact field…', icon: Plus, onSelect: () => setAddingField(true) })

  const insertTag = (key: string) => {
    const el = bodyRef.current
    const tag = `{{${key}}}`
    const body = draft.welcome_email_body
    const at = el ? el.selectionStart : body.length
    const end = el ? el.selectionEnd : body.length
    set({ welcome_email_body: body.slice(0, at) + tag + body.slice(end) })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + tag.length, at + tag.length)
    })
  }
  const tagFields = fields.filter((f) => f.key !== 'message' && f.key !== 'consent' && f.type !== 'checkbox')

  const save = () => {
    if (!draft.name.trim()) {
      setNameError('Give the form a name.')
      setPane('edit')
      setTab('fields')
      nameRef.current?.focus()
      return
    }
    onSave(draft)
  }

  const accent = draft.style?.accent ?? DEFAULT_ACCENT
  const delays = DELAYS.includes(draft.welcome_email_delay_minutes) ? DELAYS : [...DELAYS, draft.welcome_email_delay_minutes].sort((a, b) => a - b)
  const delayText = (m: number) => (m === 0 ? 'Straight away' : `${delayLabel(m)} later`)

  return (
    <div className="flex min-h-full flex-col">
      {/* On a phone the preview is a tab of its own. */}
      <div className="px-4 pt-4 lg:hidden">
        <Segmented
          label="Show"
          value={pane}
          onChange={setPane}
          options={[
            { id: 'edit', label: 'Edit' },
            { id: 'preview', label: 'Preview' },
          ]}
        />
      </div>

      <div className="grid flex-1 items-start gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)] lg:gap-8 lg:p-8 lg:pt-6">
        <div className={`min-w-0 flex-col gap-6 ${pane === 'edit' ? 'flex' : 'hidden lg:flex'}`}>
          <div className="rounded-md-m border border-border bg-card">
            <div role="tablist" aria-label="Form settings" className="flex gap-6 overflow-x-auto border-b border-border px-5 sm:px-6">
              {BUILDER_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`builder-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls="builder-panel"
                  onClick={() => setTab(t.id)}
                  className={`relative inline-flex min-h-12 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                    tab === t.id ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <t.icon className="h-4 w-4" aria-hidden />
                  {t.label}
                  {t.id === 'fields' && <span className="rounded-full bg-foreground/[0.07] px-1.5 text-xs font-medium tabular-nums text-foreground/80">{fields.length}</span>}
                </button>
              ))}
            </div>
            <div id="builder-panel" role="tabpanel" aria-labelledby={`builder-tab-${tab}`} className="divide-y divide-border/70">
            {tab === 'fields' && (<>
            <Section title="Name" description="For you, and the heading on the form's own page.">
              <Field label={<span className="sr-only">Form name</span>} error={nameError}>
                <input
                  ref={nameRef}
                  className={`${INPUT_CLASS} ${nameError ? 'border-destructive' : ''}`}
                  placeholder="Contact us"
                  value={draft.name}
                  required
                  aria-invalid={!!nameError || undefined}
                  autoFocus={isNew}
                  onChange={(e) => {
                    set({ name: e.target.value })
                    if (nameError) setNameError('')
                  }}
                />
              </Field>
            </Section>

            <Section
              title="Fields"
              description="What people fill in, in this order. Drag a field to move it, or open it to change its label."
              action={
                <ActionMenu
                  label="Add a field"
                  items={addable}
                  width={240}
                  trigger={
                    <span className="inline-flex items-center gap-1.5">
                      <Plus className="h-4 w-4" aria-hidden /> Add field
                    </span>
                  }
                  triggerClassName="inline-flex min-h-9 cursor-pointer items-center rounded-md-s border border-control bg-card px-3 text-sm font-medium text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.06)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted dark:bg-white/[0.04] dark:shadow-none"
                />
              }
            >
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={move}>
                <SortableContext items={fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
                  <ul className="flex flex-col divide-y divide-border/70 overflow-hidden rounded-md-s border border-border">
                    {fields.map((f, i) => (
                      <FieldRow
                        key={f.key}
                        field={f}
                        open={openField === f.key}
                        onToggle={() => setOpenField((k) => (k === f.key ? null : f.key))}
                        saved={draft.save_to_list_fields.includes(f.key)}
                        canSave={draft.save_to_list_enabled}
                        onSettings={(patch) => settingsFor(f.key, patch)}
                        onSaveToContact={(on) =>
                          set({ save_to_list_fields: on ? [...new Set([...draft.save_to_list_fields, f.key])] : draft.save_to_list_fields.filter((k) => k !== f.key) })
                        }
                        onRemove={() => removeField(f.key)}
                        onMove={{
                          up: i > 0 ? () => shift(f.key, -1) : undefined,
                          down: i < fields.length - 1 ? () => shift(f.key, 1) : undefined,
                        }}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            </Section>

            </>)}

            {tab === 'after' && (<>
            <Section
              title="Add to a list"
              description="Everyone who sends the form becomes a contact on this list, so you can email them."
              action={<Switch checked={draft.save_to_list_enabled} onChange={(v) => set({ save_to_list_enabled: v })} label="Add people who send the form to a list" />}
            >
              {draft.save_to_list_enabled &&
                (newList !== null ? (
                  <Field label="New list" error={createList.error?.message}>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        autoFocus
                        className={INPUT_CLASS}
                        placeholder="Website sign-ups"
                        value={newList}
                        onChange={(e) => setNewList(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newList.trim()) {
                            e.preventDefault()
                            createList.mutate(newList.trim())
                          }
                          if (e.key === 'Escape') setNewList(null)
                        }}
                      />
                      <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => setNewList(null)}>Cancel</Button>
                        <Button onClick={() => newList.trim() && createList.mutate(newList.trim())} isLoading={createList.isPending}>Create list</Button>
                      </div>
                    </div>
                  </Field>
                ) : (
                  <Field as="div" label="List" hint={<button type="button" onClick={() => setNewList('')} className="inline-flex cursor-pointer items-center gap-1 font-medium text-accent hover:underline"><Plus className="h-3.5 w-3.5" aria-hidden />New list</button>}>
                    <Select className={INPUT_CLASS} value={draft.list_id} onChange={(e) => set({ list_id: Number(e.target.value) })} aria-label="List">
                      {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                  </Field>
                ))}
              {!draft.save_to_list_enabled && <p className="text-[13px] text-muted-foreground">Submissions are kept here only; nobody is added to your contacts.</p>}
            </Section>

            <Section
              title="Welcome email"
              description="Sent to each person who sends the form."
              action={<Switch checked={draft.welcome_email_enabled} onChange={(v) => set({ welcome_email_enabled: v })} label="Send a welcome email" />}
            >
              {draft.welcome_email_enabled && (
                <div className="flex flex-col gap-4">
                  <Field as="div" label="From">
                    <Select className={INPUT_CLASS} value={draft.sender_id ?? ''} onChange={(e) => set({ sender_id: e.target.value ? Number(e.target.value) : null })} aria-label="From">
                      <option value="">Default sender</option>
                      {senders.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.email}</option>)}
                    </Select>
                  </Field>
                  <FieldGrid>
                    <Field as="div" label="Send it">
                      <Select className={INPUT_CLASS} value={draft.welcome_email_delay_minutes} onChange={(e) => set({ welcome_email_delay_minutes: Number(e.target.value) })} aria-label="When to send it">
                        {delays.map((m) => <option key={m} value={m}>{delayText(m)}</option>)}
                      </Select>
                    </Field>
                  </FieldGrid>
                  <Field label="Subject">
                    <input className={INPUT_CLASS} value={draft.welcome_email_subject} onChange={(e) => set({ welcome_email_subject: e.target.value })} />
                  </Field>
                  <Field
                    label="Message"
                    hint={
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span>Insert:</span>
                        {tagFields.map((f) => (
                          <button
                            key={f.key}
                            type="button"
                            onClick={() => insertTag(f.key)}
                            className="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            <Plus className="h-3 w-3" aria-hidden /> {f.label}
                          </button>
                        ))}
                      </span>
                    }
                  >
                    <textarea
                      ref={bodyRef}
                      className={`${INPUT_CLASS} min-h-[160px] resize-y leading-relaxed`}
                      rows={Math.min(14, Math.max(6, draft.welcome_email_body.split('\n').length + 1))}
                      value={draft.welcome_email_body}
                      onChange={(e) => set({ welcome_email_body: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </Section>

            <Section title="Thank-you message" description="What people see in place of the form once they've sent it.">
              <Field label={<span className="sr-only">Thank-you message</span>}>
                <textarea
                  className={`${INPUT_CLASS} min-h-[72px] resize-y`}
                  rows={2}
                  value={draft.success_message ?? ''}
                  onChange={(e) => {
                    set({ success_message: e.target.value })
                    setPreviewKey((k) => k + 1)
                  }}
                />
              </Field>
            </Section>

            </>)}

            {tab === 'style' && (<>
            <Section title="Button" description="What it says. People press it to send the form.">
              <FieldGrid>
                <Field label="Button text">
                  <input className={INPUT_CLASS} value={draft.submit_label ?? ''} maxLength={40} onChange={(e) => set({ submit_label: e.target.value })} />
                </Field>
              </FieldGrid>
            </Section>
            <Section title="Look" description="So the form fits in on your website.">
              <div className="flex flex-col gap-4">
                <Field as="div" label="Button colour" hint="The button's text turns dark or white to stay readable.">
                  <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Button colour">
                    {SWATCHES.map(({ hex, name }) => (
                      <button
                        key={hex}
                        type="button"
                        role="radio"
                        aria-checked={accent === hex}
                        aria-label={name}
                        title={name}
                        onClick={() => set({ style: { ...draft.style, accent: hex } })}
                        className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-white/40 ${accent === hex ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card' : ''}`}
                        style={{ background: hex }}
                      >
                        {accent === hex && <Check className="h-4 w-4" style={{ color: textOn(hex) }} aria-hidden />}
                      </button>
                    ))}
                    <label className="ml-1 inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md-s border border-input bg-card px-2 text-[13px] font-mono text-foreground">
                      <input type="color" value={accent} onChange={(e) => set({ style: { ...draft.style, accent: e.target.value } })} className="h-6 w-6 cursor-pointer appearance-none rounded border-0 bg-transparent p-0" aria-label="Choose another colour" />
                      {accent}
                    </label>
                  </div>
                </Field>
                <div className="flex flex-wrap gap-x-8 gap-y-4">
                  <Field as="div" label="Corners">
                    <Segmented label="Corners" value={draft.style?.corners ?? 'rounded'} onChange={(v) => set({ style: { ...draft.style, corners: v } })} options={CORNERS} />
                  </Field>
                  <Field as="div" label="Your website is">
                    <Segmented
                      label="Your website is"
                      value={draft.style?.theme ?? 'light'}
                      onChange={(v) => set({ style: { ...draft.style, theme: v } })}
                      options={[
                        { id: 'light', label: 'Light' },
                        { id: 'dark', label: 'Dark' },
                      ]}
                    />
                  </Field>
                </div>
              </div>
            </Section>
            <Section title="Spam" description="Every form has a hidden field that people never see and bots fill in. Anything sent with it filled is thanked and thrown away." />
            </>)}
            </div>
          </div>
        </div>

        {/* The preview stays in view while the settings scroll. */}
        <aside className={`min-w-0 lg:sticky lg:top-6 ${pane === 'preview' ? 'block' : 'hidden lg:block'}`} aria-label="Preview">
          <div className="overflow-hidden rounded-md-m border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
              <span className="text-sm font-semibold text-foreground">Preview</span>
              <Segmented
                label="Preview size"
                value={device}
                onChange={setDevice}
                options={[
                  { id: 'desktop', label: <><Monitor className="h-3.5 w-3.5" aria-hidden />Desktop</> },
                  { id: 'phone', label: <><Smartphone className="h-3.5 w-3.5" aria-hidden />Phone</> },
                ]}
              />
            </div>
            <div className={`custom-scrollbar flex justify-center overflow-y-auto px-4 py-6 lg:max-h-[calc(100dvh-17rem)] ${draft.style?.theme === 'dark' ? 'bg-[#111316]' : 'bg-[#f3f4f6] dark:bg-[#2a2d33]'}`}>
              <div
                className={`h-fit w-full rounded-[10px] border p-5 transition-[max-width] ${device === 'phone' ? 'max-w-[340px]' : 'max-w-full'} ${draft.style?.theme === 'dark' ? 'border-[#2d3139] bg-[#1d2025]' : 'border-[#e5e7eb] bg-white'}`}
              >
                <FormView
                  key={previewKey}
                  form={preview}
                  preview
                  onReset={() => setPreviewKey((k) => k + 1)}
                  activeKey={tab === 'fields' ? openField : null}
                  onFieldPick={(key) => {
                    setTab('fields')
                    setPane('edit')
                    setOpenField(key)
                    requestAnimationFrame(() => document.getElementById(`field-row-${key.replace(/[^a-z0-9_-]/gi, '_')}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
                  }}
                />
              </div>
            </div>
            <p className="flex items-center gap-2 border-t border-border/70 px-4 py-2.5 text-[13px] text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden /> Click a field to change it. Sending the preview checks the fields and shows the thank-you, but saves nothing.
            </p>
          </div>
        </aside>
      </div>

      {/* Save stays in reach at the bottom of the screen. */}
      <div className="sticky bottom-0 z-20 mt-auto border-t border-border bg-background shadow-[0_-1px_3px_rgb(17_19_22/0.04)]">
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 lg:px-8">
          <p className="mr-auto flex items-center gap-2 text-[13px] text-muted-foreground" aria-live="polite">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : dirty && !isNew ? (
              <><span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden /><span className="font-medium text-foreground">Unsaved changes</span></>
            ) : isNew ? (
              'Not saved yet'
            ) : (
              'All changes saved'
            )}
          </p>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={save} isLoading={saving}>{isNew ? 'Create form' : 'Save changes'}</Button>
        </div>
      </div>

      {addingField && (
        <Dialog isOpen onClose={() => setAddingField(false)} title="New contact field" description="A field every contact can have. It's added to this form, and you can show it on your contacts too." className="sm:max-w-lg">
          <ContactFieldForm
            submitLabel="Add to form"
            onCreated={(f) => {
              invalidateContactFields(queryClient)
              addField(`custom:${f.key}`)
              setAddingField(false)
            }}
            onCancel={() => setAddingField(false)}
          />
        </Dialog>
      )}
    </div>
  )
}
