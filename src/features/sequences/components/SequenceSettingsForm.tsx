import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { getSendersFn, mailboxesFn, updateSequenceFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Select } from '../../../components/ui/Select'
import { Switch } from '../../../components/ui/Switch'
import { queryKeys } from '../../../queryKeys'
import { FIELD_CLASS } from '../../sales/forms'
import { WEEKDAYS } from './labels'
import type { MailboxView, Sequence, SequenceSettings } from '../types'

/** Like FIELD_CLASS, but sized by its content, for fields inside a sentence. */
const INLINE = 'px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40'

const HOURS = Array.from({ length: 25 }, (_, h) => h)
const hourLabel = (h: number) => (h === 24 ? 'midnight' : `${String(h).padStart(2, '0')}:00`)

function timeZones(current: string): string[] {
  let all: string[] = []
  try {
    all = (Intl as any).supportedValuesOf?.('timeZone') ?? []
  } catch {
    // Older browsers: just the current one.
  }
  return all.includes(current) ? all : [current, ...all]
}

/** Who it sends from, when, how many a day, the sign-off and unsubscribe line, and tracking. */
export function SequenceSettingsForm({ sequence }: { sequence: Sequence }) {
  const queryClient = useQueryClient()
  const { data: senders = [] } = useQuery({ queryKey: queryKeys.email.senders(), queryFn: () => getSendersFn(), select: (r) => r.senders })
  const { data: boxes = [] } = useQuery({ queryKey: queryKeys.sequences.mailboxes(), queryFn: () => mailboxesFn() })
  const [name, setName] = useState(sequence.name)
  const [senderId, setSenderId] = useState(sequence.sender_id ? String(sequence.sender_id) : '')
  const [s, setS] = useState<SequenceSettings>(sequence.settings)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setName(sequence.name)
    setSenderId(sequence.sender_id ? String(sequence.sender_id) : '')
    setS(sequence.settings)
  }, [sequence.id])
  const zones = useMemo(() => timeZones(s.time_zone), [s.time_zone])
  const set = (patch: Partial<SequenceSettings>) => setS((cur) => ({ ...cur, ...patch }))

  const save = useMutation({
    mutationFn: () => updateSequenceFn({ data: { id: sequence.id, name, senderId: senderId ? Number(senderId) : null, settings: s } }),
    onSuccess: () => {
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
  const footerOk = /\{\{\s*unsubscribe\s*\}\}/i.test(s.footer)
  const box = boxes.find((b) => String(b.sender_id) === senderId) ?? null
  const serverReady = senders.find((x: any) => String(x.id) === senderId)?.server_ready !== false
  // Through the sender's own mailbox: no tracking, its own daily cap, and "reply stop" for the unsubscribe line.
  const viaMailbox = !!box?.sending?.active

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
      className="space-y-6 max-w-2xl"
    >
      <Field label="Name" htmlFor="seq-set-name">
        <input id="seq-set-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={FIELD_CLASS} />
      </Field>

      <Field label="Sends from" htmlFor="seq-set-sender" hint="Replies go to this address. Use a person's name: this is one person writing to another.">
        <Select id="seq-set-sender" value={senderId} onChange={(e) => setSenderId(e.target.value)} className={FIELD_CLASS}>
          <option value="">Choose a sender…</option>
          {senders.map((x: any) => (
            <option key={x.id} value={String(x.id)}>
              {x.name ? `${x.name} <${x.email}>` : x.email}
            </option>
          ))}
        </Select>
        <SendsThrough box={box} serverReady={serverReady} />
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">When it sends</legend>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
          {WEEKDAYS.map((d, i) => {
            const on = s.days.includes(i)
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => set({ days: on ? s.days.filter((x) => x !== i) : [...s.days, i].sort() })}
                className={`rounded-md border px-3 py-1.5 text-sm ${on ? 'border-accent bg-accent/10 text-accent font-medium' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {d}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Between</span>
          <Select aria-label="From" value={String(s.start_hour)} onChange={(e) => set({ start_hour: Number(e.target.value) })} className={`${INLINE} w-28`}>
            {HOURS.slice(0, 24).map((h) => (
              <option key={h} value={String(h)}>
                {hourLabel(h)}
              </option>
            ))}
          </Select>
          <span className="text-muted-foreground">and</span>
          <Select aria-label="Until" value={String(s.end_hour)} onChange={(e) => set({ end_hour: Number(e.target.value) })} className={`${INLINE} w-28`}>
            {HOURS.slice(1).map((h) => (
              <option key={h} value={String(h)}>
                {hourLabel(h)}
              </option>
            ))}
          </Select>
          <Select aria-label="Time zone" value={s.time_zone} onChange={(e) => set({ time_zone: e.target.value })} className={`${INLINE} w-56 max-w-full`}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="seq-set-cap" className="text-muted-foreground">
            At most
          </label>
          <input
            id="seq-set-cap"
            type="number"
            min={1}
            max={500}
            value={s.daily_cap}
            onChange={(e) => set({ daily_cap: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
            className={`${INLINE} w-24 tabular-nums`}
          />
          <span className="text-muted-foreground">emails a day, spread through those hours.</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {viaMailbox
            ? `Its mailbox also sends at most ${box!.sending!.daily_cap} a day across all of this sender's sequences, a few minutes apart. Sending a few at a time is what keeps cold email out of spam.`
            : 'Sending a few at a time, through the working day, is what keeps cold email out of spam. Start a new domain at 20–30 a day.'}
        </p>
      </fieldset>

      <Field label="Sign-off" htmlFor="seq-set-signature" hint="Below every email: your name, role and company, so they know who's writing (PECR).">
        <textarea id="seq-set-signature" value={s.signature} onChange={(e) => set({ signature: e.target.value })} rows={3} maxLength={2000} placeholder={'Jo Smith\nFounder, Acme'} className={`${FIELD_CLASS} resize-y`} />
      </Field>

      <Field
        label="Last line"
        htmlFor="seq-set-footer"
        hint={
          viaMailbox
            ? 'Must include {{ unsubscribe }}. Sent through the mailbox it becomes the words ‘just reply "stop"’, with no link: a reply saying so unsubscribes them and stops the sequence.'
            : 'Must include {{ unsubscribe }}, which becomes the words "Unsubscribe here", linked. Unsubscribing stops the sequence for them.'
        }
      >
        <textarea id="seq-set-footer" value={s.footer} onChange={(e) => set({ footer: e.target.value })} rows={2} maxLength={1000} className={`${FIELD_CLASS} resize-y`} />
        {!footerOk && <p className="mt-1 text-xs text-destructive">Add {'{{ unsubscribe }}'}: the sequence can't run without an unsubscribe link.</p>}
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">Tracking</legend>
        {viaMailbox && (
          <p className="text-xs text-muted-foreground max-w-lg">
            Off while it sends through {box!.user}'s own mailbox: tracking would put links to this app's address in every email, which is what spam filters look for.
          </p>
        )}
        <Toggle
          checked={s.track_opens && !viaMailbox}
          onChange={(v) => set({ track_opens: v })}
          disabled={viaMailbox}
          label="Track opens"
          hint="Adds a hidden image. It needs the person's consent under PECR, makes a personal email look like marketing, and Apple Mail opens everything anyway. Replies are the number that matters."
        />
        <Toggle
          checked={s.track_clicks && !viaMailbox}
          onChange={(v) => set({ track_clicks: v })}
          disabled={viaMailbox}
          label="Track link clicks"
          hint="Links go through this app first. Spam filters look harder at redirected links in cold email."
        />
      </fieldset>

      <div className="flex items-center justify-end gap-3">
        <span className="flex-1 text-xs text-destructive">{(save.error as Error | null)?.message}</span>
        {saved && <span className="text-xs text-muted-foreground" role="status">Saved</span>}
        <Button type="submit" isLoading={save.isPending}>
          Save settings
        </Button>
      </div>
    </form>
  )
}

/**
 * How this sender's emails go out (their own mailbox, or the workspace's mail
 * server) and whether replies are noticed, with a way to set either up; or,
 * where that server can't send from the address yet either, that they can't.
 */
function SendsThrough({ box, serverReady }: { box: MailboxView | null; serverReady: boolean }) {
  const link = (
    <Link to="/settings" search={{ tab: 'senders' }} className="text-accent hover:underline">
      Settings → Mailboxes
    </Link>
  )
  const TONES = { ok: 'text-emerald-700 dark:text-emerald-400', plain: 'text-muted-foreground', warn: 'text-amber-700 dark:text-amber-400', bad: 'text-destructive' }
  const line = (tone: keyof typeof TONES, words: React.ReactNode) => <p className={`mt-1 text-xs break-words ${TONES[tone]}`}>{words}</p>
  const domainFirst = "the workspace's mail server can't send from this address until its domain is set up in Settings → Sending"
  if (!box) {
    if (!serverReady) return line('warn', <>Can't send yet: {domainFirst}. Connect this sender's inbox in {link} to send through its own mailbox, or set the domain up.</>)
    return line('warn', <>Sends through the workspace's mail server, and replies aren't detected. Connect this sender's inbox in {link} to send through its own mailbox, which reaches more inboxes, and to notice replies.</>)
  }
  const replies = box.status === 'ok' ? null : line('bad', <>Reply detection isn't working ({box.last_error}). Fix it in {link}.</>)
  const sending = box.sending
  if (sending?.active) {
    return (
      <>
        {line('ok', <>Sends through {box.user}'s own mailbox, up to {sending.daily_cap} a day, and replies there stop that person's emails.</>)}
        {replies}
      </>
    )
  }
  if (sending?.verified_at && !sending.use_server) {
    return (
      <>
        {line('bad', <>Sending through {box.user} has stopped, so these emails wait. {sending.last_error} Fix it in {link}.</>)}
        {replies}
      </>
    )
  }
  if (!serverReady) {
    const words = sending?.use_server
      ? <>Can't send yet: it's set to go through the workspace's mail server, and {domainFirst}. Switch sending through its mailbox back on in {link}, or set the domain up.</>
      : <>Can't send yet: its mailbox couldn't send, and {domainFirst}. {sending?.last_error} Fix it in {link}, or set the domain up.</>
    return (
      <>
        {line('warn', words)}
        {replies}
      </>
    )
  }
  const why = sending?.use_server
    ? 'Sends through the workspace\'s mail server, as chosen for this sender.'
    : sending?.last_error
      ? `Sends through the workspace's mail server for now: its mailbox couldn't send. ${sending.last_error}`
      : "Sends through the workspace's mail server until its mailbox's sending has been checked."
  return (
    <>
      {line(sending?.use_server ? 'plain' : 'warn', <>{why}{box.status === 'ok' ? ` Replies are detected from ${box.user}.` : ''} Change it in {link}.</>)}
      {replies}
    </>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <div>
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground max-w-lg">{hint}</p>
      </div>
    </div>
  )
}
