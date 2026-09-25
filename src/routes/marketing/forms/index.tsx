import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { Plus, FileText, Trash2, Code2, Pencil, Check, Copy, Mail, Clock, Users, List as ListIcon, ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { getFormsFn, createFormFn, updateFormFn, deleteFormFn, getSendersFn } from '../../../server/functions'
import { listsFn, createListFn } from '../../../server/functions'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge } from '../../../components/ui/Badge'

export const Route = createFileRoute('/marketing/forms/')({
  component: FormsPage,
})

type Form = {
  id: string
  name: string
  fields: string[]
  list_id: number
  save_to_list_enabled: boolean
  save_to_list_fields: string[]
  welcome_email_enabled: boolean
  welcome_email_subject: string
  welcome_email_body: string
  welcome_email_delay_minutes: number
  sender_id: number | null
  created_at: string
  submission_count: number
}

const AVAILABLE_FIELDS = ['first_name', 'last_name', 'email', 'company', 'message']
const FIELD_LABELS: Record<string, string> = {
  first_name: 'First Name',
  last_name: 'Last Name',
  email: 'Email',
  company: 'Company',
  message: 'Message',
}

// Fields that map to an actual contact attribute — email is always the
// join key and message has no contact column, so neither is selectable.
const SAVEABLE_CONTACT_FIELDS = ['first_name', 'last_name', 'company']

const DEFAULT_FORM = {
  name: '',
  fields: ['first_name', 'email'],
  list_id: 1,
  save_to_list_enabled: true,
  save_to_list_fields: ['first_name', 'last_name', 'company'],
  welcome_email_enabled: false,
  welcome_email_subject: 'Thanks for getting in touch',
  welcome_email_body: 'Hi {{first_name}},\n\nThank you for getting in touch. Someone from our team will be in touch shortly.\n\nBest,\nThe Team',
  welcome_email_delay_minutes: 5,
  sender_id: null as number | null,
}

function generateEmbedSnippet(form: Form, origin: string) {
  const fieldInputs = form.fields
    .map(f => {
      if (f === 'email') return `  <input name="email" type="email" placeholder="Email *" required />`
      if (f === 'message') return `  <textarea name="message" placeholder="Message" rows="4"></textarea>`
      return `  <input name="${f}" placeholder="${FIELD_LABELS[f] || f}${f === 'first_name' ? ' *' : ''}"${f === 'first_name' ? ' required' : ''} />`
    })
    .join('\n')

  return `<!-- Place this where you want the form -->
<div id="em-form-${form.id}"></div>

<!-- Paste this script once on your page -->
<script>
(function() {
  var FORM_ID = '${form.id}';
  var API = '${origin}';
  var root = document.getElementById('em-form-' + FORM_ID);
  if (!root) return;

  /* Override these CSS variables to style the form */
  var style = document.createElement('style');
  style.textContent = [
    '#em-form-' + FORM_ID + '{display:flex;flex-direction:column;gap:var(--em-gap,12px);width:var(--em-width,100%);font-family:var(--em-font,inherit)}',
    '#em-form-' + FORM_ID + ' input,#em-form-' + FORM_ID + ' textarea{width:100%;box-sizing:border-box;padding:var(--em-input-p,10px 14px);border:var(--em-input-border,1px solid #d1d5db);border-radius:var(--em-radius,6px);background:var(--em-input-bg,#fff);color:var(--em-input-color,inherit);font:inherit}',
    '#em-form-' + FORM_ID + ' button{padding:var(--em-btn-p,10px 20px);background:var(--em-btn-bg,#111827);color:var(--em-btn-color,#fff);border:none;border-radius:var(--em-radius,6px);cursor:pointer;font:inherit;font-weight:600}',
    '#em-form-' + FORM_ID + ' button:hover{opacity:0.9}',
  ].join('');
  document.head.appendChild(style);

  root.innerHTML = '${fieldInputs.replace(/\n/g, '\\n').replace(/'/g, "\\'")}\\n  <button type="button">Submit</button>';

  root.querySelector('button').addEventListener('click', function() {
    var inputs = root.querySelectorAll('input,textarea');
    var data = {};
    inputs.forEach(function(i) { data[i.name] = i.value; });
    fetch(API + '/api/form-submit/' + FORM_ID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function(r) {
      if (r.ok) root.innerHTML = '<p style="margin:0">Thanks! We\\'ll be in touch shortly.</p>';
    });
  });
})();
<\/script>`
}

/**
 * Full-page form builder. Rendered in place of the forms list rather than in a
 * modal — the field/list/welcome-email sections are too tall for a dialog on a
 * phone. The caller remounts it via `key` when switching between create and
 * edit, so the initial state is picked up on mount.
 */
function FormBuilder({
  onClose,
  initial,
  onSave,
  isSaving,
  lists,
  senders,
}: {
  onClose: () => void
  initial: typeof DEFAULT_FORM
  onSave: (data: typeof DEFAULT_FORM) => void
  isSaving: boolean
  lists: Array<{ id: number; name: string }>
  senders: Array<{ id: number; name: string; email: string }>
}) {
  const queryClient = useQueryClient()
  // Forms created before save-to-list existed won't have these fields set.
  const normalize = (data: typeof DEFAULT_FORM) => ({
    ...data,
    save_to_list_enabled: data.save_to_list_enabled ?? true,
    save_to_list_fields: data.save_to_list_fields ?? DEFAULT_FORM.save_to_list_fields,
  })
  const [form, setForm] = useState(() => normalize(initial))
  const [isCreatingList, setIsCreatingList] = useState(false)
  const [newListName, setNewListName] = useState('')

  const createListMutation = useMutation({
    mutationFn: (name: string) => createListFn({ data: { name } }),
    onSuccess: (newList) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      setForm(f => ({ ...f, list_id: newList.id }))
      setIsCreatingList(false)
      setNewListName('')
    },
  })

  const toggleField = (field: string) => {
    if (field === 'email') return // email is always required
    setForm(f => ({
      ...f,
      fields: f.fields.includes(field) ? f.fields.filter(x => x !== field) : [...f.fields, field],
      // Dropping a field from the form also drops it from what gets saved to the list
      save_to_list_fields: f.fields.includes(field)
        ? f.save_to_list_fields.filter(x => x !== field)
        : f.save_to_list_fields,
    }))
  }

  const toggleSaveField = (field: string) => {
    setForm(f => ({
      ...f,
      save_to_list_fields: f.save_to_list_fields.includes(field)
        ? f.save_to_list_fields.filter(x => x !== field)
        : [...f.save_to_list_fields, field],
    }))
  }

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto flex flex-col gap-6 animate-in fade-in duration-200">
      <button
        onClick={onClose}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors group cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to forms
      </button>

      <div>
        <h1 className="text-2xl font-display text-foreground mb-2">
          {initial.name ? 'Edit form' : 'Create a form'}
        </h1>
        <p className="text-muted-foreground">
          Pick the fields to capture, choose where submissions are saved, and optionally send a welcome email.
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Form Name</label>
          <input
            className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="e.g. Contact Page Form"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>

        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <ListIcon className="w-4 h-4" /> Save Contact to a List
            </label>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, save_to_list_enabled: !f.save_to_list_enabled }))}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                form.save_to_list_enabled ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                form.save_to_list_enabled ? 'translate-x-4.5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {form.save_to_list_enabled && (
            <div className="space-y-4">
              {isCreatingList ? (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">New list name</label>
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      type="text"
                      className="flex-1 px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                      placeholder="e.g. Newsletter Subscribers"
                      value={newListName}
                      onChange={e => setNewListName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newListName.trim()) {
                          e.preventDefault()
                          createListMutation.mutate(newListName.trim())
                        }
                      }}
                    />
                    <button
                      type="button"
                      disabled={!newListName.trim() || createListMutation.isPending}
                      onClick={() => createListMutation.mutate(newListName.trim())}
                      className="px-3 py-2 bg-accent text-accent-foreground rounded-md-s text-sm font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
                    >
                      {createListMutation.isPending ? 'Creating...' : 'Create'}
                    </button>
                  </div>
                  {createListMutation.isError && (
                    <p className="text-xs text-destructive mt-1.5">
                      {(createListMutation.error as Error).message}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => { setIsCreatingList(false); setNewListName('') }}
                    className="text-xs text-accent hover:underline font-medium mt-2 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Contact List</label>
                  <select
                    className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                    value={form.list_id}
                    onChange={e => setForm(f => ({ ...f, list_id: Number(e.target.value) }))}
                  >
                    <option value="">Choose a list...</option>
                    {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setIsCreatingList(true)}
                    className="text-xs text-accent hover:underline font-medium mt-2 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    Create new list
                  </button>
                </div>
              )}

              <div>
                <label className="block text-xs text-muted-foreground mb-2">Fields to save to the contact record</label>
                <div className="flex flex-wrap gap-2">
                  {SAVEABLE_CONTACT_FIELDS.filter(field => form.fields.includes(field)).map(field => {
                    const active = form.save_to_list_fields.includes(field)
                    return (
                      <button
                        key={field}
                        type="button"
                        onClick={() => toggleSaveField(field)}
                        className={`px-3 py-1.5 rounded-md-s text-xs font-medium border transition-colors cursor-pointer ${
                          active
                            ? 'bg-accent text-accent-foreground border-accent'
                            : 'bg-background text-muted-foreground border-border hover:border-accent/50'
                        }`}
                      >
                        {FIELD_LABELS[field]}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Email is always saved as the contact&apos;s identifier.{' '}
                  {SAVEABLE_CONTACT_FIELDS.filter(f => form.fields.includes(f)).length === 0 &&
                    'Enable more fields above to choose what else gets saved.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Fields</label>
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_FIELDS.map(field => {
              const active = form.fields.includes(field)
              const locked = field === 'email'
              return (
                <button
                  key={field}
                  type="button"
                  onClick={() => toggleField(field)}
                  disabled={locked}
                  className={`px-3 py-1.5 rounded-md-s text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-accent text-accent-foreground border-accent'
                      : 'bg-background text-muted-foreground border-border hover:border-accent/50'
                  } ${locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {FIELD_LABELS[field]}{locked ? ' *' : ''}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">Email is always included.</p>
        </div>

        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Mail className="w-4 h-4" /> Welcome Email
            </label>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, welcome_email_enabled: !f.welcome_email_enabled }))}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                form.welcome_email_enabled ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                form.welcome_email_enabled ? 'translate-x-4.5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {form.welcome_email_enabled && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <input
                  type="number"
                  min={1}
                  max={1440}
                  className="w-20 px-2 py-1.5 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  value={form.welcome_email_delay_minutes}
                  onChange={e => setForm(f => ({ ...f, welcome_email_delay_minutes: Number(e.target.value) }))}
                />
                <span className="text-sm text-muted-foreground">minutes after submission</span>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Send from</label>
                <select
                  className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  value={form.sender_id ?? ''}
                  onChange={e => setForm(f => ({ ...f, sender_id: e.target.value ? Number(e.target.value) : null }))}
                >
                  <option value="">— Default sender —</option>
                  {senders.map(s => (
                    <option key={s.id} value={s.id}>{s.name} &lt;{s.email}&gt;</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1">Subject</label>
                <input
                  className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  value={form.welcome_email_subject}
                  onChange={e => setForm(f => ({ ...f, welcome_email_subject: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Body <span className="text-accent">{'{{first_name}}'}</span> and <span className="text-accent">{'{{last_name}}'}</span> are replaced automatically
                </label>
                <textarea
                  rows={5}
                  className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  value={form.welcome_email_body}
                  onChange={e => setForm(f => ({ ...f, welcome_email_body: e.target.value }))}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border pt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={isSaving || !form.name.trim() || (form.save_to_list_enabled && !form.list_id)}
            className="bg-accent text-accent-foreground px-5 py-2 rounded-md-s text-sm font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center gap-2"
          >
            {isSaving ? 'Saving...' : <><Check className="w-4 h-4" /> Save Form</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function EmbedModal({ form, onClose }: { form: Form; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const snippet = generateEmbedSnippet(form, origin)

  const copy = () => {
    navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog isOpen onClose={onClose} title={`Embed: ${form.name}`} className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <div className="px-6 pb-6 space-y-4 mt-4">
        <p className="text-sm text-muted-foreground">
          Paste this snippet into your website where you want the form to appear. The form will resize to fit its container and can be styled with CSS variables.
        </p>

        <div className="relative">
          <pre className="bg-muted rounded-md-s p-4 text-xs overflow-x-auto text-foreground/80 max-h-64 border border-border">
            {snippet}
          </pre>
          <button
            onClick={copy}
            className="absolute top-2 right-2 p-1.5 rounded-md-s bg-background border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="bg-accent/5 rounded-md-s p-4 border border-accent/10 text-xs space-y-1.5">
          <p className="font-semibold text-foreground mb-2">Style it with CSS variables</p>
          <p className="text-muted-foreground font-mono">{'--em-btn-bg'}: your button colour</p>
          <p className="text-muted-foreground font-mono">{'--em-radius'}: border radius</p>
          <p className="text-muted-foreground font-mono">{'--em-input-border'}: input border style</p>
          <p className="text-muted-foreground font-mono">{'--em-gap'}: spacing between fields</p>
          <p className="text-muted-foreground font-mono">{'--em-font'}: font family</p>
          <p className="text-muted-foreground mt-2">Add these to <code className="bg-muted px-1 rounded">#em-form-{form.id} {'{ }'}</code> in your CSS.</p>
        </div>

        <div className="pt-1">
          <p className="text-xs text-muted-foreground mb-1 font-medium">Or use the raw API endpoint (POST JSON):</p>
          <code className="text-xs bg-muted px-3 py-2 rounded-md-s block text-foreground/70 border border-border break-all">
            {origin}/api/form-submit/{form.id}
          </code>
        </div>
      </div>
    </Dialog>
  )
}

function FormsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [showCreate, setShowCreate] = useState(false)
  const [editForm, setEditForm] = useState<Form | null>(null)
  const [embedForm, setEmbedForm] = useState<Form | null>(null)

  const { data: forms = [], isLoading } = useQuery({
    queryKey: queryKeys.email.forms(),
    queryFn: () => getFormsFn(),
  })

  const { data: listsData } = useQuery({
    queryKey: queryKeys.email.lists(),
    queryFn: () => listsFn(),
  })
  const lists = (listsData?.lists || []) as Array<{ id: number; name: string }>

  const { data: sendersData } = useQuery({
    queryKey: queryKeys.email.senders(),
    queryFn: () => getSendersFn(),
  })
  const senders = (sendersData?.senders || []) as Array<{ id: number; name: string; email: string }>

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.email.forms() })

  const createMutation = useMutation({
    mutationFn: (data: typeof DEFAULT_FORM) => createFormFn({ data }),
    onSuccess: () => { invalidate(); setShowCreate(false) },
  })

  const updateMutation = useMutation({
    mutationFn: (data: typeof DEFAULT_FORM) =>
      updateFormFn({ data: { id: editForm!.id, updates: data } }),
    onSuccess: () => { invalidate(); setEditForm(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFormFn({ data: { id } }),
    onSuccess: invalidate,
  })

  const confirmDelete = (form: Form) => {
    if (confirm(`Delete "${form.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(form.id)
    }
  }

  // Take over the viewport while building a form rather than opening a modal.
  // `key` forces a remount so the builder picks up whichever form is being
  // edited (or a blank one) as its initial state.
  if (showCreate || editForm) {
    return (
      <FormBuilder
        key={editForm?.id ?? 'new'}
        initial={editForm ?? DEFAULT_FORM}
        onClose={() => {
          setShowCreate(false)
          setEditForm(null)
        }}
        onSave={data => (editForm ? updateMutation.mutate(data) : createMutation.mutate(data))}
        isSaving={editForm ? updateMutation.isPending : createMutation.isPending}
        lists={lists}
        senders={senders}
      />
    )
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-2">Forms</h1>
          <p className="text-muted-foreground">Create embeddable forms that capture contacts and trigger welcome emails.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-accent text-accent-foreground px-6 py-2.5 rounded-md-s font-medium hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 shadow-accent cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          New Form
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-40 border border-border rounded-md-m" />
          ))}
        </div>
      ) : (forms as Form[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-accent" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">No forms yet</h3>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Create your first form to start capturing contacts from your website.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-accent text-accent-foreground px-5 py-2.5 rounded-md-s font-medium hover:brightness-110 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Create Form
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(forms as Form[]).map(form => {
            const list = lists.find(l => l.id === form.list_id)
            return (
              <div 
                key={form.id} 
                className="card border border-border rounded-md-m p-6 flex flex-col gap-4 cursor-pointer hover:border-accent/50 transition-colors relative group"
                onClick={() => navigate({ to: '/marketing/forms/$formId', params: { formId: form.id } })}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-foreground truncate">{form.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {form.save_to_list_enabled === false
                        ? 'Not saved to a list'
                        : (list?.name || `List #${form.list_id}`)}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditForm(form) }}
                      className="p-1.5 rounded-md-s text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer relative z-10"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); confirmDelete(form) }}
                      className="p-1.5 rounded-md-s text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer relative z-10"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {form.fields.map(f => (
                    <Badge key={f} variant="default">{FIELD_LABELS[f] || f}</Badge>
                  ))}
                </div>

                <button 
                  onClick={(e) => { e.stopPropagation(); navigate({ to: '/marketing/forms/$formId', params: { formId: form.id } }) }}
                  className="flex items-center gap-2 text-xs text-muted-foreground transition-colors cursor-pointer text-left w-fit relative z-10"
                >
                  <Users className="w-3.5 h-3.5 transition-colors" />
                  <span>
                    <span className="font-semibold text-foreground transition-colors">{form.submission_count}</span>
                    {' '}submission{form.submission_count !== 1 ? 's' : ''}
                  </span>
                </button>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="w-3.5 h-3.5" />
                  {form.welcome_email_enabled
                    ? <span className="text-green-600 dark:text-green-400">Welcome email in {form.welcome_email_delay_minutes}min</span>
                    : <span>No welcome email</span>}
                </div>

                <button
                  onClick={(e) => { e.stopPropagation(); setEmbedForm(form) }}
                  className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium border border-accent/30 text-accent rounded-md-s hover:bg-accent/10 transition-colors cursor-pointer mt-auto relative z-10"
                >
                  <Code2 className="w-4 h-4" /> Get Embed Code
                </button>
              </div>
            )
          })}
        </div>
      )}

      {embedForm && <EmbedModal form={embedForm} onClose={() => setEmbedForm(null)} />}
    </div>
  )
}
