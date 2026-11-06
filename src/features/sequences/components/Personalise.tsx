import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import { sequenceDraftFn, sequenceEnrollmentsFn, tryPersonalEmailFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { Select } from '../../../components/ui/Select'
import { Switch } from '../../../components/ui/Switch'
import { queryKeys } from '../../../queryKeys'
import { BRIEF_MAX, SUBJECT_MAX, type EnrollmentView, type PersonalDraft, type ResearchFact, type Sequence, type SequenceStep } from '../types'
import { when } from './labels'

// Personalised emails (server/sequences/personalise.ts): the switch and brief
// on the first email (for the whole sequence), "Try it on…" for the first
// email, and each person's own emails on the People tab.

/** Whether the AI can write them here (server/copilot/availability.ts). */
export type AiState = { ok: true; web: boolean } | { ok: false; reason: string }

type StepDraft = Pick<SequenceStep, 'subject' | 'body' | 'personalise'>

/** The first email's "write each person's version" switch, its brief, and a try on one contact. */
export function PersonaliseBox({ sequence, step, ai, onChange }: { sequence: Sequence; step: StepDraft; ai: AiState | undefined; onChange: (patch: Partial<StepDraft>) => void }) {
  const on = !!step.personalise
  const blocked = ai && !ai.ok
  return (
    <div className="rounded-lg border border-border bg-background p-3 sm:p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Switch
          id="personalise"
          checked={on}
          onChange={(v) => onChange({ personalise: v ? { brief: step.personalise?.brief ?? '' } : null })}
          label="Write each person's emails with AI"
          disabled={blocked && !on}
        />
        <label htmlFor="personalise" className="min-w-0 cursor-pointer">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-accent" /> Write each person's emails with AI
          </span>
          <span className="block text-xs text-muted-foreground leading-relaxed">
            It looks up their company on the web, then writes them their own first email and follow-ups from your brief, each from what they've already been
            sent. Each email below is the example it follows, and what's sent when it can't write one.
          </span>
        </label>
      </div>
      {blocked && <Notice level={on ? 'warning' : 'info'}>{ai.reason}</Notice>}
      {on && ai?.ok && !ai.web && (
        <Notice>Only an OpenAI key is set up, so it can't look companies up on the web: it writes from their job and company alone. Add an Anthropic key in Settings → Copilot for company research.</Notice>
      )}
      {on && (
        <>
          <Field label="Brief" hint="What you offer, who it helps, what you'd like them to do, and anything to avoid. It uses only facts it finds, never made-up ones.">
            <textarea
              value={step.personalise?.brief ?? ''}
              onChange={(e) => onChange({ personalise: { brief: e.target.value } })}
              rows={4}
              maxLength={BRIEF_MAX}
              placeholder="We help small accounting firms automate client onboarding. Ask if they'd like a 15-minute demo next week. Don't mention pricing."
              className={`${INPUT_CLASS} resize-y font-[inherit]`}
            />
          </Field>
          <Notice level="warning">Each person's emails send as the AI writes them, without review. Try the first one on a few people before you start the sequence.</Notice>
          <TryItOn sequence={sequence} step={step} disabled={blocked} />
        </>
      )}
    </div>
  )
}

/** Writes one contact's email now, from the step as it's being edited. Nothing is kept or sent. */
function TryItOn({ sequence, step, disabled }: { sequence: Sequence; step: StepDraft; disabled?: boolean }) {
  const { data: people = [] } = useQuery({
    queryKey: queryKeys.sequences.enrollments(sequence.id),
    queryFn: () => sequenceEnrollmentsFn({ data: { id: sequence.id } }),
  })
  const [email, setEmail] = useState('')
  useEffect(() => {
    if (!email && people[0]) setEmail(people[0].contact_email)
  }, [people, email])
  const tryIt = useMutation({
    mutationFn: () =>
      tryPersonalEmailFn({ data: { id: sequence.id, subject: step.subject, body: step.body, brief: step.personalise?.brief ?? '', contactEmail: email.trim() } }),
  })
  const result = tryIt.data

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Try it on" className="flex-1 min-w-[14rem]">
          {people.length ? (
            <Select value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLASS}>
              {people.slice(0, 200).map((p) => (
                <option key={p.id} value={p.contact_email}>
                  {[p.name ?? p.contact_email, p.company].filter(Boolean).join(' · ')}
                </option>
              ))}
            </Select>
          ) : (
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="A contact's email address" className={INPUT_CLASS} />
          )}
        </Field>
        <Button variant="secondary" leftIcon={<Sparkles className="w-4 h-4" />} isLoading={tryIt.isPending} disabled={disabled || !email.trim() || !step.body.trim()} onClick={() => tryIt.mutate()}>
          Write theirs
        </Button>
      </div>
      {tryIt.isPending && <p className="text-xs text-muted-foreground">Looking up their company and writing… this can take a few minutes.</p>}
      {tryIt.error && <Notice level="error">{(tryIt.error as Error).message}</Notice>}
      {result && !tryIt.isPending && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm space-y-3">
          <p className="text-xs text-muted-foreground">
            As {result.contact} would get it{result.status === 'fallback' ? ': the standard email, because the AI’s couldn’t be used.' : '. Nothing was sent or kept.'}
          </p>
          {result.reason && <Notice level="warning">{result.reason}</Notice>}
          <p className="font-medium text-foreground">{result.subject || '(no subject)'}</p>
          <pre className="whitespace-pre-wrap break-words font-[inherit] text-foreground">{result.text}</pre>
          <Facts facts={result.facts} />
        </div>
      )}
    </div>
  )
}

/** The company facts an email was written from, with where each was read. */
export function Facts({ facts }: { facts: ResearchFact[] | undefined }) {
  if (!facts?.length) return <p className="text-xs text-muted-foreground">Written from their job and company: nothing was found about the company to mention.</p>
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-1">What it was written from</p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {facts.map((f, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden>·</span>
            <span className="min-w-0 break-words">
              {f.text}
              {f.url && (
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-accent hover:underline">
                  source <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const emailLabel = (index: number) => (index === 0 ? 'First email' : `Follow-up ${index}`)

/** The email of theirs that matters now: the next one, or the last one sent. */
function currentDraft(sequence: Sequence, e: EnrollmentView): { index: number; draft: PersonalDraft } | null {
  const next = sequence.steps[e.next_step]
  if (next && e.drafts?.[next.id] && (e.status === 'active' || e.status === 'paused')) return { index: e.next_step, draft: e.drafts[next.id] }
  for (let i = sequence.steps.length - 1; i >= 0; i--) {
    const d = e.drafts?.[sequence.steps[i].id]
    if (d && e.sends.some((x) => x.step_id === sequence.steps[i].id)) return { index: i, draft: d }
  }
  return null
}

/** Where a person's own emails are, for the People tab. */
export function PersonalBadge({ sequence, e }: { sequence: Sequence; e: EnrollmentView }) {
  const now = currentDraft(sequence, e)
  if (!now) return <span className="text-xs text-muted-foreground">—</span>
  const { index, draft: p } = now
  const label = `${emailLabel(index)} · `
  if (p.status === 'pending') return <Badge variant="info">{label}{p.attempts ? 'writing… (trying again)' : 'writing…'}</Badge>
  if (p.status === 'fallback') return <Badge variant="warning">{label}standard email</Badge>
  return <Badge variant="success">{label}{p.edited ? 'personalised, edited' : 'personalised'}</Badge>
}

/** Every email written for them, in order: what each says and was written from, and, before it's gone, edit it or write it again. */
export function PersonalDraftsPanel({ sequence, e }: { sequence: Sequence; e: EnrollmentView }) {
  const shown = sequence.steps.map((step, index) => ({ step, index })).filter(({ step }) => e.drafts?.[step.id])
  if (!shown.length) return <p className="text-sm text-muted-foreground">Nothing written for them yet.</p>
  return (
    <div className="space-y-5">
      {shown.map(({ step, index }) => (
        <div key={step.id} className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">
            {emailLabel(index)}
            {e.sends.find((x) => x.step_id === step.id) ? ` · sent ${when(e.sends.find((x) => x.step_id === step.id)!.at)}` : index === e.next_step ? ' · next' : ''}
          </p>
          <DraftView sequence={sequence} e={e} stepId={step.id} index={index} />
        </div>
      ))}
    </div>
  )
}

function DraftView({ sequence, e, stepId, index }: { sequence: Sequence; e: EnrollmentView; stepId: string; index: number }) {
  const queryClient = useQueryClient()
  const p = e.drafts?.[stepId]
  const sent = e.sends.some((x) => x.step_id === stepId) || index < e.next_step
  // A follow-up that replies in the thread has no subject of its own.
  const threaded = index > 0 && !sequence.steps[index]?.subject?.trim()
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState(p?.subject ?? '')
  const [body, setBody] = useState(p?.body ?? '')
  useEffect(() => {
    if (editing) return
    setSubject(p?.subject ?? '')
    setBody(p?.body ?? '')
  }, [p?.subject, p?.body, editing])
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.enrollments(sequence.id) })
  const change = useMutation({
    mutationFn: (rewrite: boolean) =>
      sequenceDraftFn({ data: rewrite ? { enrollmentId: e.id, stepId, rewrite: true } : { enrollmentId: e.id, stepId, ...(threaded ? {} : { subject }), body } }),
    onSuccess: () => {
      setEditing(false)
      refresh()
    },
  })
  if (!p) return null
  const canChange = !sent && e.status !== 'stopped' && e.status !== 'finished' && e.status !== 'replied' && sequence.status !== 'archived'

  return (
    <div className="space-y-3 text-sm">
      {p.status === 'pending' && (
        <p className="text-muted-foreground">
          {sequence.status === 'active' ? 'Being written: it’s done in the day before it’s due.' : 'It’s written once the sequence is running, in the day before it’s due.'}
        </p>
      )}
      {p.status === 'fallback' && <Notice level="warning">{sent ? 'The standard email went to them' : 'The standard email goes to them'}: {p.reason}</Notice>}
      {p.status === 'ready' &&
        (editing ? (
          <div className="space-y-2">
            {!threaded && <input aria-label="Subject" value={subject} onChange={(ev) => setSubject(ev.target.value)} maxLength={SUBJECT_MAX} className={INPUT_CLASS} />}
            <textarea aria-label="Email text" value={body} onChange={(ev) => setBody(ev.target.value)} rows={8} className={`${INPUT_CLASS} resize-y font-[inherit]`} />
            <p className="text-xs text-muted-foreground">Your sign-off and the unsubscribe line are added below it. Edited emails stay as you wrote them.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="font-medium text-foreground mb-2">{threaded ? 'Re: (the email before)' : p.subject}</p>
            <pre className="whitespace-pre-wrap break-words font-[inherit] text-foreground">{p.body}</pre>
          </div>
        ))}
      {p.status === 'ready' && <Facts facts={p.facts} />}
      {change.error && <p className="text-xs text-destructive">{(change.error as Error).message}</p>}
      {canChange && (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" isLoading={change.isPending && change.variables === false} onClick={() => change.mutate(false)}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {p.status === 'ready' && (
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {p.status !== 'pending' && (
                <Button size="sm" variant="ghost" leftIcon={<RefreshCw className="w-3.5 h-3.5" />} isLoading={change.isPending && change.variables === true} onClick={() => change.mutate(true)}>
                  Write it again
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
