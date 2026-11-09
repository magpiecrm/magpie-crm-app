import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AlignLeft, ArrowDown, ArrowLeft, ArrowUp, AtSign, Bell, Briefcase, Building2, Calendar, Check, GripVertical, Hash, ListChecks, Lock, Monitor, Plus, ShieldCheck,
  Eye, Info, Palette, Pencil, Send, Smartphone, SquareChevronDown, SquareCheck, Trash2, Type, User,
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
import { Link } from '@tanstack/react-router'
import type { FormInput } from '../../../server/functions/forms'
import { queryKeys } from '../../../queryKeys'
import type { ContactFieldDef } from '../../contacts/contactFields'
import {
  BUILTIN_FORM_FIELDS, BUILTIN_LABELS, DEFAULT_ACCENT, DEFAULT_SUBMIT_LABEL, DEFAULT_SUCCESS_MESSAGE, customKey, fillMergeTags,
  publicForm, resolveFields, type FormCorners, type FormRecord, type ResolvedFormField,
} from '../model'
import { FormView, HEADING_PICK } from './FormView'
import { textOn } from '../render'
import { delayLabel } from '../format'

/** Where an existing form's page header leaves room for the builder's name box. */
export const FORM_TITLE_SLOT = 'form-title-slot'

export type FormDraft = Required<Pick<FormInput, 'name' | 'fields' | 'list_id' | 'save_to_list_enabled' | 'save_to_list_fields' | 'welcome_email_enabled' | 'welcome_email_subject' | 'welcome_email_body' | 'welcome_email_delay_minutes' | 'sender_id'>> &
  Pick<FormInput, 'field_settings' | 'submit_label' | 'success_message' | 'style' | 'heading' | 'intro' | 'privacy_url' | 'redirect_url'>

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
  heading: '',
  intro: '',
  privacy_url: '',
  redirect_url: '',
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
    heading: form.heading ?? '',
    intro: form.intro ?? '',
    privacy_url: form.privacy_url ?? '',
    redirect_url: form.redirect_url ?? '',
    style: form.style ?? {},
  }
}

const BUILTIN_ICONS: Record<string, LucideIcon> = {
  first_name: User, last_name: User, email: AtSign, company: Building2, job_title: Briefcase, message: AlignLeft, consent: ShieldCheck,
}
const TYPE_ICONS: Record<ResolvedFormField['type'], LucideIcon> = {
  text: Type, email: AtSign, textarea: AlignLeft, number: Hash, date: Calendar, checkbox: SquareCheck, select: SquareChevronDown, multiselect: ListChecks,
}
const TYPE_NAMES: Record<ResolvedFormField['type'], string> = {
  text: 'Short text', email: 'Email', textarea: 'Long text', number: 'Number', date: 'Date', checkbox: 'Tick box', select: 'Dropdown', multiselect: 'Choices',
}
const CONTACT_TYPE_ICONS: Record<ContactFieldDef['type'], LucideIcon> = {
  text: Type, number: Hash, date: Calendar, boolean: SquareCheck, select: SquareChevronDown, multiselect: ListChecks,
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

/** The height of an element, kept up to date. */
function useHeight(ref: React.RefObject<HTMLElement | null>, fallback: number) {
  const [h, setH] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setH(Math.round(el.getBoundingClientRect().height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return h
}

/**
 * Fits the preview to the screen on a desktop: the space under the bars, and
 * the form scaled down a little (not below 90%) when it's taller than that.
 * Anything left over scrolls. A phone shows it at full size.
 */
function usePreviewFit(barH: number, layoutKey: string) {
  const areaRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [maxHeight, setMaxHeight] = useState<number | null>(null)
  // Measured when the form's layout changes (fields, heading, width) and on resize, not as messages come and go
  // while someone tries it, so the form doesn't change size under the pointer.
  useLayoutEffect(() => {
    const measure = () => {
      const area = areaRef.current
      const card = cardRef.current
      if (!area || window.innerWidth < 1024) {
        setMaxHeight(null)
        setZoom(1)
        return
      }
      // Under the bars and the preview's own header; above its note and a margin.
      const room = Math.max(280, window.innerHeight - area.getBoundingClientRect().top - 70)
      setMaxHeight(room)
      if (!card) return
      const was = card.style.zoom
      card.style.zoom = '1'
      const natural = card.offsetHeight
      card.style.zoom = was
      const z = (room - 48) / natural
      // Nearly fits: full size and a little scroll beats a form shrunk by a few per cent.
      // Never below 90%: smaller than that, labels are too small to read, so the rest scrolls.
      setZoom(z >= 0.97 ? 1 : Math.max(0.9, z))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [barH, layoutKey])
  return { areaRef, cardRef, zoom, maxHeight }
}

/** The welcome email as it arrives: who it's from, the subject, the message with sample details. */
function EmailPreview({ from, to, subject, body, when }: { from?: { name: string; email: string }; to: string; subject: string; body: string; when: number }) {
  return (
    <div className="h-fit w-full max-w-[460px] overflow-hidden rounded-[10px] border border-border bg-card text-left shadow-[0_1px_2px_rgb(17_19_22/0.05)]">
      <dl className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 border-b border-border/70 px-4 py-3 text-[13px]">
        <dt className="text-muted-foreground">From</dt>
        <dd className="truncate text-foreground">{from ? `${from.name} <${from.email}>` : 'Your default sender'}</dd>
        <dt className="text-muted-foreground">To</dt>
        <dd className="truncate text-foreground">{to}</dd>
        <dt className="text-muted-foreground">When</dt>
        <dd className="text-foreground">{when ? `${delayLabel(when)} after they send the form` : 'Straight after they send the form'}</dd>
      </dl>
      <div className="px-4 py-4">
        <p className="mb-3 text-[15px] font-semibold text-foreground">{subject || <span className="text-muted-foreground">No subject yet</span>}</p>
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{body || <span className="text-muted-foreground">No message yet</span>}</p>
      </div>
    </div>
  )
}

/** "Optional", inline after a label, as the form itself shows it. */
const Opt = () => <span className="ml-1 font-normal text-muted-foreground">Optional</span>

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
            value === o.id ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.1)] ring-1 ring-border dark:bg-white/[0.2] dark:ring-white/25' : 'text-muted-foreground hover:text-foreground'
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
  onSettings: (patch: { label?: string; placeholder?: string; required?: boolean; help?: string; hidden?: boolean; param?: string }) => void
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
      className={`${open ? 'relative z-[1] bg-card shadow-[inset_0_0_0_1.5px_var(--accent)] rounded-md-s' : 'bg-card'} ${isDragging ? 'relative z-10 rounded-md-s shadow-md ring-1 ring-border' : ''}`}
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
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md-xs border border-border bg-background text-foreground/75 max-sm:hidden" title={TYPE_NAMES[field.type]}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${field.label}: ${open ? 'hide' : 'show'} its settings`}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-start justify-center rounded-md-xs px-1 py-0.5 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="w-full truncate text-sm font-medium text-foreground">{isConsent ? 'Consent' : field.label}</span>
          <span className="w-full truncate text-[13px] text-muted-foreground">
            {locked ? (
              <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden /> Always required: it's how the person is saved</span>
            ) : field.hidden ? `Hidden, from ?${field.param}=` : isConsent ? field.label : TYPE_NAMES[field.type]}
            {custom && !field.hidden && ' · Contact field'}
            {!locked && <span className="sm:hidden"> · {field.required ? 'Required' : 'Optional'}</span>}
          </span>
        </button>
        {/* The Required column: one tick box per row, under its heading; Email's is a lock, as it can't be optional. */}
        <label
          className={`flex h-9 w-[4.5rem] shrink-0 items-center justify-center rounded-md-xs max-sm:hidden ${locked ? 'cursor-help' : 'cursor-pointer hover:bg-muted'} ${field.hidden ? 'invisible' : ''}`}
          title={locked ? "Always required: it's how the person is saved" : field.required ? 'Required' : 'Optional'}
        >
          {locked ? (
            <span role="img" aria-label="Email is always required" className="flex h-4 w-4 items-center justify-center rounded-[4px] bg-accent/70 text-accent-foreground">
              <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
            </span>
          ) : (
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={field.required}
              onChange={(e) => onSettings({ required: e.target.checked })}
              aria-label={`${field.label} is required`}
            />
          )}
        </label>

        <ActionMenu
          label={`Actions for ${field.label}`}
          width={196}
          items={[
            { label: 'Move up', icon: ArrowUp, onSelect: () => onMove.up?.(), disabled: !onMove.up },
            { label: 'Move down', icon: ArrowDown, onSelect: () => onMove.down?.(), disabled: !onMove.down },
            ...(locked ? [] : (['separator', { label: 'Remove field', icon: Trash2, tone: 'danger', onSelect: onRemove }] as ActionMenuItem[])),
          ]}
        />
      </div>
      {open && (
        <div id={panelId} className="mx-1.5 mb-1.5 flex flex-col gap-4 rounded-md-xs bg-muted/40 px-4 py-4">
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
              <Field label={<>Help text <Opt /></>} hint="A line under the label.">
                <input className={INPUT_CLASS} value={field.help} onChange={(e) => onSettings({ help: e.target.value })} placeholder={field.key === 'email' ? "We'll only use it to reply" : ''} />
              </Field>
              {field.type !== 'checkbox' && field.type !== 'multiselect' && field.type !== 'select' && field.type !== 'date' && (
                <Field label={<>Placeholder <Opt /></>} hint="Shown in the empty box.">
                  <input className={INPUT_CLASS} value={field.placeholder} placeholder={field.type === 'email' ? 'name@company.com' : ''} onChange={(e) => onSettings({ placeholder: e.target.value })} />
                </Field>
              )}
            </FieldGrid>
          )}
          {field.options && field.options.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-foreground">Choices</span>
              <p className="text-sm text-foreground">{field.options.join(' · ')}</p>
              <span className="text-[13px] text-muted-foreground">
                The contact field's own choices, shared with your contacts. Change them in{' '}
                <Link to="/settings" search={{ tab: 'fields' }} className="font-medium text-accent hover:underline">Settings → Contact fields</Link>.
              </span>
            </div>
          )}
          {custom && ['text', 'number', 'select'].includes(field.type) && (
            <div className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-foreground">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={field.hidden} onChange={(e) => onSettings({ hidden: e.target.checked })} />
                <span>
                  Hidden, filled from the page's address
                  <span className="block text-[13px] text-muted-foreground">For where someone came from: a link ending <span className="font-mono">?{field.param}=newsletter</span> fills it with “newsletter”.</span>
                </span>
              </label>
              {field.hidden && (
                <Field label="Address parameter" className="sm:max-w-xs">
                  <input className={`${INPUT_CLASS} font-mono`} value={field.param} onChange={(e) => onSettings({ param: e.target.value.replace(/[^\w.-]/g, '') })} />
                </Field>
              )}
            </div>
          )}
          {!locked && !field.hidden && (
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground sm:hidden">
              <input type="checkbox" className="h-4 w-4" checked={field.required} onChange={(e) => onSettings({ required: e.target.checked })} />
              Required
            </label>
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
  backLabel,
  onBack,
  status,
  subtitle,
}: {
  initial: FormDraft
  isNew: boolean
  /** The top bar's back link ("Forms", "Templates"). */
  backLabel: string
  onBack: () => void
  /** Beside the name: whether it's live. */
  status?: ReactNode
  /** Under the name: a line about the form. */
  subtitle?: ReactNode
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
  // On a phone the preview is a tab of its own; on a desktop it's always beside the settings.
  const [tab, setTabState] = useState<BuilderTab | 'preview'>('fields')
  const settingsTab: BuilderTab = tab === 'preview' ? 'fields' : tab
  const setTab = (t: BuilderTab | 'preview') => {
    setTabState(t)
    if (t === 'after') setShowing(draft.welcome_email_enabled ? 'email' : 'thanks')
    else if (t !== 'preview') setShowing('form')
  }
  const [showing, setShowing] = useState<'form' | 'thanks' | 'email'>('form')
  const [sendTo, setSendTo] = useState<'message' | 'page'>(initial.redirect_url ? 'page' : 'message')
  const barRef = useRef<HTMLDivElement>(null)
  const barH = useHeight(barRef, 92)
  const headingRef = useRef<HTMLInputElement>(null)
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!isNew) setTitleSlot(document.getElementById(FORM_TITLE_SLOT))
  }, [isNew])
  const [previewKey, setPreviewKey] = useState(0)
  const [nameError, setNameError] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial])
  const set = (patch: Partial<FormDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const record = { ...draft, id: 'preview', created_at: '' } as FormRecord
  const fields = resolveFields(record, contactFields)
  const preview = publicForm(record, contactFields)
  const fit = usePreviewFit(barH, JSON.stringify([preview.fields.map((f) => [f.key, f.label, f.help, f.type]), preview.heading, preview.intro, preview.privacyUrl, device, showing, tab]))

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

  const settingsFor = (key: string, patch: { label?: string; placeholder?: string; required?: boolean; help?: string; hidden?: boolean; param?: string }) =>
    setDraft((d) => {
      const current = { ...(d.field_settings?.[key] ?? {}) }
      if (patch.label !== undefined) current.label = patch.label
      if (patch.placeholder !== undefined) current.placeholder = patch.placeholder
      if (patch.required !== undefined) current.required = patch.required
      if (patch.help !== undefined) current.help = patch.help
      if (patch.hidden !== undefined) current.hidden = patch.hidden
      if (patch.param !== undefined) current.param = patch.param
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
  const sample: Record<string, string> = { first_name: 'Priya', last_name: 'Raman', email: 'priya@example.com', company: 'Northwind Freight', job_title: 'Head of Operations' }
  const tagFields = fields.filter((f) => f.key !== 'message' && f.key !== 'consent' && f.type !== 'checkbox')

  const save = () => {
    if (!draft.name.trim()) {
      setNameError('Give the form a name.')
      setTab('fields')
      nameRef.current?.focus()
      return
    }
    onSave(draft)
  }

  // The form's name, edited where its title is: the new form's header, or the form page's.
  const nameInput = (
    <label className="group/name relative flex min-w-0 items-center">
      <input
        ref={nameRef}
        aria-label="Form name"
        title="Rename the form. Only you see its name."
        placeholder="Untitled form"
        value={draft.name}
        required
        aria-invalid={!!nameError || undefined}
        aria-describedby={nameError ? 'form-name-error' : undefined}
        onChange={(e) => {
          set({ name: e.target.value })
          if (nameError) setNameError('')
        }}
        size={Math.max(10, Math.min(40, draft.name.length + 1))}
        className={`peer -mx-1.5 min-w-[6ch] max-w-full truncate rounded-md-xs border border-transparent bg-transparent px-1.5 py-0.5 text-2xl font-display text-foreground [field-sizing:content] placeholder:text-muted-foreground/70 transition-colors hover:border-input focus:border-accent focus:bg-card focus:outline-none focus:ring-[3px] focus:ring-accent/20 ${nameError ? '!border-destructive' : ''}`}
      />
      <Pencil className="ml-2 h-4 w-4 shrink-0 text-muted-foreground/70 transition-opacity peer-focus:opacity-0" aria-hidden />
    </label>
  )

  const accent = draft.style?.accent ?? DEFAULT_ACCENT
  const delays = DELAYS.includes(draft.welcome_email_delay_minutes) ? DELAYS : [...DELAYS, draft.welcome_email_delay_minutes].sort((a, b) => a - b)
  const delayText = (m: number) => (m === 0 ? 'Straight away' : `${delayLabel(m)} later`)

  return (
    <div className="flex min-h-full flex-col">
      {/* A new form has a header of its own; an existing one puts its name in the form page's header. */}
      {isNew ? (
        <div className="px-4 pt-4 lg:px-8 lg:pt-6">
          <button type="button" onClick={onBack} className="mb-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md-xs text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <ArrowLeft className="h-4 w-4" aria-hidden /> {backLabel}
          </button>
          <div className="flex min-w-0 items-center gap-3">{nameInput}{status}</div>
          {nameError ? <p id="form-name-error" className="mt-0.5 text-[13px] text-destructive">{nameError}</p> : subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      ) : (
        titleSlot && createPortal(
          <div className="min-w-0">
            {nameInput}
            {nameError && <p id="form-name-error" className="mt-0.5 text-[13px] text-destructive">{nameError}</p>}
          </div>,
          titleSlot,
        )
      )}

      {/* One bar, pinned under the app's: the builder's tabs (with Preview on a phone) and saving. */}
      <div ref={barRef} className={`sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-20 border-b border-border bg-card ${isNew ? 'mt-4 border-t' : ''}`}>
        <div className="flex items-center gap-x-4 px-4 lg:px-8">
          <div role="tablist" aria-label="Form settings" className="-mb-px flex min-w-0 flex-1 gap-5 overflow-x-auto sm:gap-6">
            {[...BUILDER_TABS, { id: 'preview' as const, label: 'Preview', icon: Eye }].map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`builder-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="builder-panel"
                onClick={() => setTab(t.id)}
                className={`relative inline-flex min-h-12 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${t.id === 'preview' ? 'lg:hidden' : ''} ${
                  tab === t.id ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <t.icon className="h-4 w-4 max-sm:hidden" aria-hidden />
                {t.label}
                {t.id === 'fields' && <span className="rounded-full bg-foreground/[0.07] px-1.5 text-xs font-medium tabular-nums text-foreground/80 max-sm:hidden">{fields.length}</span>}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2 py-1.5">
            <p className="flex items-center gap-1.5 text-[13px]" aria-live="polite">
              {error ? (
                <span className="text-destructive">{error}</span>
              ) : dirty && !isNew ? (
                <><span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden /><span className="font-medium text-foreground max-sm:sr-only">Unsaved changes</span></>
              ) : isNew ? (
                <span className="text-muted-foreground max-md:hidden">Not saved yet</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden /><span className="max-sm:sr-only">Saved</span></span>
              )}
            </p>
            {isNew ? (
              <Button variant="secondary" size="sm" onClick={onCancel} className="max-sm:hidden">Cancel</Button>
            ) : (
              dirty && <Button variant="secondary" size="sm" onClick={() => setDraft(initial)}>Discard</Button>
            )}
            {/* Nothing to save: no Save button at all, just "Saved". */}
            {(isNew || dirty) && <Button size="sm" onClick={save} isLoading={saving}>{isNew ? 'Create form' : 'Save'}</Button>}
          </div>
        </div>
      </div>

      <div className="grid flex-1 items-start gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)] lg:gap-8 lg:p-8 lg:pt-6">
        <div className={`min-w-0 flex-col gap-6 ${tab !== 'preview' ? 'flex' : 'hidden lg:flex'}`}>
          <div className="rounded-md-m border border-border bg-card">
            <div id="builder-panel" role="tabpanel" aria-labelledby={`builder-tab-${settingsTab}`} className="divide-y divide-border/70">
            {settingsTab === 'fields' && (<>
            <section className="flex flex-col gap-3 px-5 py-5 sm:px-6" aria-label="Fields">
              <div className="flex items-center justify-between gap-4">
                <p className="text-[13px] leading-relaxed text-muted-foreground">What people fill in, in this order. Drag a field to move it, or open it to change it.</p>
                <ActionMenu
                  label="Add a field"
                  items={addable}
                  width={240}
                  trigger={
                    <span className="inline-flex items-center gap-1.5">
                      <Plus className="h-4 w-4" aria-hidden /> Add field
                    </span>
                  }
                  triggerClassName="inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-md-s border border-control bg-card px-3 text-sm font-medium text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.06)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted dark:bg-white/[0.04] dark:shadow-none"
                />
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={move}>
                <SortableContext items={fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
                  <div className="overflow-hidden rounded-md-s border border-border">
                  <div className="hidden items-center gap-2 border-b border-border bg-muted/40 py-2 pl-[5.375rem] pr-2 text-[13px] font-medium text-muted-foreground sm:flex" aria-hidden>
                    <span className="flex-1">Field</span>
                    <span className="w-[4.5rem] text-center">Required</span>
                    <span className="w-[2rem]" />
                  </div>
                  <ul className="flex flex-col divide-y divide-border/70">
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
                  </div>
                </SortableContext>
              </DndContext>
            </section>

            <Section title="Heading and intro" description="Above the fields, on the form's page and in the embed. Leave them empty if your page says it already.">
              <Field label="Heading">
                <input ref={headingRef} className={INPUT_CLASS} value={draft.heading ?? ''} maxLength={120} placeholder="Get in touch" onChange={(e) => set({ heading: e.target.value })} />
              </Field>
              <Field label={<>Intro <Opt /></>}>
                <textarea className={`${INPUT_CLASS} min-h-[64px] resize-y`} rows={2} value={draft.intro ?? ''} placeholder="Tell us a little about what you need and we'll reply within a day." onChange={(e) => set({ intro: e.target.value })} />
              </Field>
            </Section>
            </>)}

            {settingsTab === 'after' && (<>
            <Section title="Once it's sent" description="What people see next: a message in place of the form, or a page of your own (for a thank-you page that counts ad conversions).">
              <Segmented
                label="Once it's sent"
                value={sendTo}
                onChange={(v) => {
                  setSendTo(v)
                  if (v === 'message') set({ redirect_url: '' })
                  setShowing('thanks')
                }}
                options={[
                  { id: 'message', label: 'Show a message' },
                  { id: 'page', label: 'Go to a page' },
                ]}
              />
              {sendTo === 'page' ? (
                <Field label="Page address" hint="Anyone who sends the form goes here.">
                  <input className={INPUT_CLASS} type="url" inputMode="url" placeholder="https://yoursite.com/thanks" value={draft.redirect_url ?? ''} onFocus={() => setShowing('thanks')} onChange={(e) => set({ redirect_url: e.target.value })} />
                </Field>
              ) : (
                <Field label={<span className="sr-only">Thank-you message</span>}>
                  <textarea
                    className={`${INPUT_CLASS} min-h-[72px] resize-y`}
                    rows={2}
                    value={draft.success_message ?? ''}
                    onFocus={() => setShowing('thanks')}
                    onChange={(e) => {
                      set({ success_message: e.target.value })
                      setPreviewKey((k) => k + 1)
                    }}
                  />
                </Field>
              )}
            </Section>
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
              action={<Switch checked={draft.welcome_email_enabled} onChange={(v) => { set({ welcome_email_enabled: v }); setShowing(v ? 'email' : 'thanks') }} label="Send a welcome email" />}
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
                    <input className={INPUT_CLASS} value={draft.welcome_email_subject} onFocus={() => setShowing('email')} onChange={(e) => set({ welcome_email_subject: e.target.value })} />
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
                      onFocus={() => setShowing('email')}
                      onChange={(e) => set({ welcome_email_body: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </Section>


            <div className="flex flex-col gap-2 px-5 py-4 text-[13px] leading-relaxed text-muted-foreground sm:px-6">
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Spam protection is on: a hidden field bots fill in and people never see.</span>
              </p>
              <p className="flex items-start gap-2">
                <Bell className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Each submission shows in your notifications (the bell), and on your phone if you've turned that on.</span>
              </p>
            </div>

            </>)}

            {settingsTab === 'style' && (<>
            <Section title="Button and privacy" description="What the button says, and a link to your privacy policy under it.">
              <FieldGrid>
                <Field label="Button text">
                  <input className={INPUT_CLASS} value={draft.submit_label ?? ''} maxLength={40} onChange={(e) => set({ submit_label: e.target.value })} />
                </Field>
              </FieldGrid>
              <FieldGrid>
                <Field label={<>Privacy policy link <Opt /></>} hint="Shown under the button as “How we use your details”." className="sm:col-span-2">
                  <input className={INPUT_CLASS} type="url" inputMode="url" placeholder="https://yoursite.com/privacy" value={draft.privacy_url ?? ''} onChange={(e) => set({ privacy_url: e.target.value })} />
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
                        className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-black/15 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-white/45 ${accent === hex ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card' : ''}`}
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
                  <Field as="div" label="Font">
                    <Segmented
                      label="Font"
                      value={draft.style?.font ?? 'sans'}
                      onChange={(v) => set({ style: { ...draft.style, font: v } })}
                      options={[
                        { id: 'sans', label: <span style={{ fontFamily: 'system-ui, sans-serif' }}>Sans</span> },
                        { id: 'serif', label: <span style={{ fontFamily: 'Charter, Cambria, Georgia, serif' }}>Serif</span> },
                        { id: 'rounded', label: <span style={{ fontFamily: 'ui-rounded, Nunito, system-ui, sans-serif' }}>Rounded</span> },
                      ]}
                    />
                  </Field>
                  <Field as="div" label="Boxes">
                    <Segmented
                      label="Boxes"
                      value={draft.style?.fields ?? 'outline'}
                      onChange={(v) => set({ style: { ...draft.style, fields: v } })}
                      options={[
                        { id: 'outline', label: 'Outlined' },
                        { id: 'filled', label: 'Filled' },
                      ]}
                    />
                  </Field>
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

            </>)}
            </div>
          </div>
        </div>

        {/* The preview stays in view while the settings scroll, shrunk to fit the screen when the form is long. */}
        <aside
          className={`min-w-0 lg:sticky ${tab === 'preview' ? 'block' : 'hidden lg:block'}`}
          style={{ top: `calc(4rem + env(safe-area-inset-top, 0px) + ${barH}px + 1.5rem)` }}
          aria-label="Preview"
        >
          <div className="overflow-hidden rounded-md-m border border-border bg-card">
            <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border/70 px-4 py-2">
              <span className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
                Preview
              </span>
              {settingsTab === 'after' ? (
                <Segmented
                  label="Preview of"
                  value={showing === 'form' ? 'thanks' : showing}
                  onChange={(v) => setShowing(v)}
                  options={[
                    { id: 'thanks', label: 'Thank-you' },
                    ...(draft.welcome_email_enabled ? [{ id: 'email' as const, label: 'Welcome email' }] : []),
                  ]}
                />
              ) : (
                <div className="max-lg:hidden">
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
              )}
            </div>
            <div
              ref={fit.areaRef}
              className={`custom-scrollbar flex justify-center overflow-y-auto px-4 py-6 ${showing === 'email' ? 'bg-muted/40' : draft.style?.theme === 'dark' ? 'bg-[#111316]' : 'bg-[#f3f4f6] dark:bg-[#2a2d33]'}`}
              style={fit.maxHeight ? { maxHeight: fit.maxHeight } : undefined}
            >
              {showing === 'email' ? (
                <EmailPreview
                  from={senders.find((x) => x.id === draft.sender_id)}
                  to={sample.email}
                  subject={fillMergeTags(draft.welcome_email_subject, sample)}
                  body={fillMergeTags(draft.welcome_email_body, sample)}
                  when={draft.welcome_email_delay_minutes}
                />
              ) : (
                <div
                  ref={fit.cardRef}
                  className={`h-fit w-full origin-top rounded-[10px] border p-5 transition-[max-width] ${device === 'phone' ? 'max-w-[340px]' : 'max-w-full'} ${draft.style?.theme === 'dark' ? 'border-[#2d3139] bg-[#1d2025]' : 'border-[#e5e7eb] bg-white'}`}
                  style={showing === 'form' && fit.zoom < 0.99 ? { zoom: fit.zoom } : undefined}
                >
                  <FormView
                    key={`${previewKey}-${showing}`}
                    form={preview}
                    preview
                    done={showing === 'thanks'}
                    onReset={() => {
                      setShowing('form')
                      setPreviewKey((k) => k + 1)
                    }}
                    activeKey={settingsTab === 'fields' ? openField : null}
                    onFieldPick={(key) => {
                      if (key === HEADING_PICK) {
                        setTab('fields')
                        requestAnimationFrame(() => headingRef.current?.focus())
                        return
                      }
                      setTab('fields')
                      setOpenField(key)
                      requestAnimationFrame(() => document.getElementById(`field-row-${key.replace(/[^a-z0-9_-]/gi, '_')}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
                    }}
                  />
                </div>
              )}
            </div>
            <p className="flex items-center gap-2 border-t border-border/70 px-4 py-2.5 text-[13px] text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {showing === 'email'
                ? `How the email reads, with sample details. It's sent ${draft.welcome_email_delay_minutes ? `${delayLabel(draft.welcome_email_delay_minutes)} after` : 'as soon as'} someone sends the form.`
                : showing === 'thanks'
                  ? 'What people see once they have sent the form.'
                  : 'Click a field to change it. Sending the preview checks the fields and shows the thank-you, but saves nothing.'}
            </p>
          </div>
        </aside>
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
