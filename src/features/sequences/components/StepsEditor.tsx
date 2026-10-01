import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, Eye, Plus, Trash2 } from 'lucide-react'
import { getContactFieldsFn, previewSequenceStepFn, updateSequenceFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Select } from '../../../components/ui/Select'
import { queryKeys } from '../../../queryKeys'
import { FIELD_CLASS } from '../../sales/forms'
import { percent } from './labels'
import type { Sequence, SequenceStep } from '../types'

type Draft = Pick<SequenceStep, 'delay_days' | 'subject' | 'body'> & { id?: string }

interface StepStats {
  id: string
  sent: number
  opened: number
  clicked: number
  replied: number
  bounced: number
  waiting: number
}

const MERGE_TAGS = [
  { tag: '{{ contact.first_name | default: "there" }}', label: 'First name' },
  { tag: '{{ contact.last_name }}', label: 'Last name' },
  { tag: '{{ contact.COMPANY }}', label: 'Company' },
  { tag: '{{ contact.EMAIL }}', label: 'Email' },
]

/** The sequence's emails: what each says, and how long after the one before it goes. */
export function StepsEditor({ sequence, stats }: { sequence: Sequence; stats: StepStats[] }) {
  const queryClient = useQueryClient()
  const [steps, setSteps] = useState<Draft[]>(sequence.steps)
  const [saved, setSaved] = useState(false)
  useEffect(() => setSteps(sequence.steps), [sequence.id])
  const dirty = JSON.stringify(steps) !== JSON.stringify(sequence.steps.map(({ campaign_id: _c, ...s }) => s))
  const save = useMutation({
    mutationFn: () => updateSequenceFn({ data: { id: sequence.id, steps: steps.map((s) => ({ id: s.id, delay_days: s.delay_days, subject: s.subject, body: s.body })) } }),
    onSuccess: (s) => {
      setSteps(s.steps)
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.sequence(sequence.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.list() })
    },
  })
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2500)
    return () => clearTimeout(t)
  }, [saved])

  const change = (i: number, patch: Partial<Draft>) => setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={step.id ?? `new-${i}`}>
          {i > 0 && (
            <div className="flex items-center gap-2 py-2 pl-4 text-sm text-muted-foreground">
              <ArrowDown className="w-4 h-4" />
              <label htmlFor={`wait-${i}`}>Wait</label>
              <input
                id={`wait-${i}`}
                type="number"
                min={0}
                max={90}
                value={step.delay_days}
                onChange={(e) => change(i, { delay_days: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })}
                className="w-16 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground tabular-nums"
              />
              <span>{step.delay_days === 1 ? 'day' : 'days'} with no reply, then</span>
            </div>
          )}
          <StepCard
            sequence={sequence}
            index={i}
            step={step}
            stats={stats.find((s) => s.id === step.id)}
            onChange={(patch) => change(i, patch)}
            onRemove={steps.length > 1 ? () => setSteps((all) => all.filter((_, j) => j !== i)) : undefined}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        {steps.length < 10 && (
          <Button variant="secondary" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setSteps((all) => [...all, { delay_days: 3, subject: null, body: '' }])}>
            Add a follow-up
          </Button>
        )}
        <span className="flex-1" />
        <span className="text-xs text-destructive">{(save.error as Error | null)?.message}</span>
        {saved && !dirty && <span className="text-xs text-muted-foreground" role="status">Saved</span>}
        <Button onClick={() => save.mutate()} isLoading={save.isPending} disabled={!dirty}>
          Save emails
        </Button>
      </div>
    </div>
  )
}

function StepCard({
  sequence,
  index,
  step,
  stats,
  onChange,
  onRemove,
}: {
  sequence: Sequence
  index: number
  step: Draft
  stats?: StepStats
  onChange: (patch: Partial<Draft>) => void
  onRemove?: () => void
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const { data: fields = [] } = useQuery({ queryKey: queryKeys.email.contactFields(), queryFn: () => getContactFieldsFn() })
  const [preview, setPreview] = useState<{ subject: string; text: string; contact: string; empty: string[] } | null>(null)
  const show = useMutation({
    mutationFn: () => previewSequenceStepFn({ data: { id: sequence.id, stepIndex: index, subject: step.subject, body: step.body } }),
    onSuccess: setPreview,
  })
  const threaded = index > 0 && step.subject === null
  const insert = (tag: string) => {
    const el = bodyRef.current
    const at = el?.selectionStart ?? step.body.length
    onChange({ body: step.body.slice(0, at) + tag + step.body.slice(el?.selectionEnd ?? at) })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + tag.length, at + tag.length)
    })
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{index === 0 ? 'First email' : `Follow-up ${index}`}</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          {stats && stats.sent > 0 && (
            <span>
              Sent {stats.sent} · replied {stats.replied} ({percent(stats.replied, stats.sent)})
              {sequence.settings.track_opens ? ` · opened ${percent(stats.opened, stats.sent)}` : ''}
              {stats.bounced ? ` · bounced ${stats.bounced}` : ''}
            </span>
          )}
          {stats && stats.waiting > 0 && <span>{stats.waiting} waiting</span>}
          {onRemove && (
            <button type="button" onClick={onRemove} aria-label={`Remove ${index === 0 ? 'the first email' : `follow-up ${index}`}`} className="p-1 hover:text-destructive">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {index > 0 && (
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={threaded} onChange={() => onChange({ subject: null })} className="accent-accent" />
            Reply in the same thread
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={!threaded} onChange={() => onChange({ subject: step.subject ?? '' })} className="accent-accent" />
            New subject
          </label>
        </div>
      )}
      {threaded ? (
        <p className="text-sm text-muted-foreground">Subject: Re: (the email before)</p>
      ) : (
        <input
          aria-label="Subject"
          value={step.subject ?? ''}
          onChange={(e) => onChange({ subject: e.target.value })}
          placeholder="Subject, e.g. Quick question, {{ contact.first_name }}"
          maxLength={200}
          className={FIELD_CLASS}
        />
      )}
      <textarea
        ref={bodyRef}
        aria-label="Email text"
        value={step.body}
        onChange={(e) => onChange({ body: e.target.value })}
        rows={index === 0 ? 9 : 5}
        placeholder={
          index === 0
            ? 'Hi {{ contact.first_name }},\n\nOne or two sentences on why you’re writing to them, specifically.\n\nOne question they can answer in a line.'
            : 'A short nudge: a new reason to reply, not "just checking in".'
        }
        maxLength={10_000}
        className={`${FIELD_CLASS} resize-y font-[inherit]`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Insert a contact's detail"
          value=""
          onChange={(e) => e.target.value && insert(e.target.value)}
          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground"
        >
          <option value="">Insert a detail…</option>
          {MERGE_TAGS.map((m) => (
            <option key={m.tag} value={m.tag}>
              {m.label}
            </option>
          ))}
          {fields.map((f: { key: string; label: string }) => (
            <option key={f.key} value={`{{ contact.custom.${f.key} }}`}>
              {f.label}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" leftIcon={<Eye className="w-3.5 h-3.5" />} isLoading={show.isPending} onClick={() => show.mutate()} disabled={!step.body.trim()}>
          Preview
        </Button>
        <span className="text-xs text-muted-foreground">Your sign-off and the unsubscribe line are added below (Settings).</span>
      </div>
      {preview && (
        <div className="rounded-lg border border-border bg-background p-4 text-sm">
          <p className="text-xs text-muted-foreground mb-2">As {preview.contact} would get it:</p>
          <p className="font-medium text-foreground mb-2">{preview.subject || '(no subject)'}</p>
          <pre className="whitespace-pre-wrap break-words font-[inherit] text-foreground">{preview.text}</pre>
          {preview.empty.length > 0 && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Empty for this contact: {preview.empty.join(', ')}. Add a fallback, e.g. {'{{ contact.first_name | default: "there" }}'}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
