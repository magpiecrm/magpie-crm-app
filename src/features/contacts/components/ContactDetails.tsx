import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, ArrowRight, Plus } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { deleteContactsFn, getContactDetailsFn, getDefaultSenderFn, sendIndividualEmailFn } from '../../../server/functions'
import { Dialog, DialogBody, DialogFooter, MetaList } from '../../../components/ui/Dialog'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { toast } from '../../../components/ui/toast'
import { confirmDialog } from '../../../components/ui/confirm'
import { Button } from '../../../components/ui/Button'
import { Section, SECTION_ACTION } from '../../../components/ui/RecordSection'
import { SegmentedTabs } from '../../templates/components/SegmentedTabs'
import { useIsDesktop } from '../../../hooks/useMediaQuery'
import { RecordTasks } from '../../sales/components/TaskParts'
import { ContactSequences } from '../../sequences/components/ContactSequences'
import { buildFeed, matchesFilter, type FeedFilter } from '../record'
import { ContactHeader } from './record/ContactHeader'
import { ContactSidebar, emailStatus, useResubscribe } from './record/ContactSidebar'
import { FeedLabel, FeedList, NoteComposer, UpcomingRow, type NoteComposerHandle } from './record/ContactFeed'

interface ContactDetailsProps {
  email: string
  onClose: () => void
}

/** `details` is the side panel, a tab of its own on a phone. */
type Tab = 'overview' | 'activity' | 'details'

/** How many of the latest items the Overview shows before "View all". */
const RECENT = 4

const FILTERS: Array<{ value: FeedFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'emails', label: 'Emails' },
  { value: 'notes', label: 'Notes' },
  { value: 'forms', label: 'Forms and surveys' },
]

export function ContactDetails({ email, onClose }: ContactDetailsProps) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const isDesktop = useIsDesktop()
  const [filter, setFilter] = useState<FeedFilter>('all')
  const note = useRef<NoteComposerHandle>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
  const resubscribe = useResubscribe(email)
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false)
  // Who the email comes from: the workspace's default sender, as sending uses it.
  const { data: fromData } = useQuery({ queryKey: queryKeys.email.defaultSender(), queryFn: () => getDefaultSenderFn(), enabled: isEmailModalOpen })
  // `"Alex Morgan" <alex@acme.com>` → name and address.
  const fromMatch = fromData?.sender?.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  const from = fromData?.sender ? { name: fromMatch?.[1]?.trim() || null, email: fromMatch?.[2] ?? fromData.sender } : null
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [isSendingEmail, setIsSendingEmail] = useState(false)

  const {
    data: detailsData,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.email.contact(email),
    queryFn: () => getContactDetailsFn({ data: { email } }),
  })
  const details = detailsData?.success ? detailsData : null
  const feed = useMemo(
    () =>
      details
        ? buildFeed(
            details.activity,
            details.notes,
            details.replies,
            details.surveyResponses.map((r) => ({ id: r.id, answers: r.answers })),
          )
        : [],
    [details],
  )
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.email.contact(email) })

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6 animate-pulse">
        <div className="h-5 w-32 bg-muted rounded" />
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-6 w-48 bg-muted rounded" />
            <div className="h-4 w-64 bg-muted rounded" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[21rem_minmax(0,1fr)] gap-6">
          <div className="h-96 bg-muted rounded-xl" />
          <div className="h-96 bg-muted rounded-xl" />
        </div>
      </div>
    )
  }

  if (error || !details) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-8 py-16 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-destructive mx-auto" aria-hidden />
        <h1 className="text-lg font-semibold text-foreground">Couldn’t open this contact</h1>
        <p className="text-sm text-muted-foreground">{(detailsData as { error?: string } | undefined)?.error || error?.message || 'Something went wrong.'}</p>
        <Button variant="secondary" onClick={onClose} leftIcon={<ArrowLeft className="h-4 w-4" />}>
          Back to contacts
        </Button>
      </div>
    )
  }

  const { contact, lists, campaigns, fieldDefs, sequences, company, deals } = details
  const name = `${contact.attributes.FIRSTNAME} ${contact.attributes.LASTNAME}`.trim()
  const firstName = contact.attributes.FIRSTNAME || name || 'them'
  const status = emailStatus(contact.status)
  const canEmail = status.tone === 'good'

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(contact.email)
      toast.success('Email address copied')
    } catch {
      toast.error("Couldn't copy the address")
    }
  }
  const deleteContact = async () => {
    const ok = await confirmDialog({
      title: `Delete ${name || contact.email}?`,
      message: 'They come off every list, sequence and deal, and their history goes with them. This can’t be undone.',
      confirmLabel: 'Delete contact',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deleteContactsFn({ data: { emails: [contact.email] } })
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.contacts() })
      toast.success('Contact deleted')
      onClose()
    } catch (err) {
      toast.error("Couldn't delete the contact", { description: err instanceof Error ? err.message : undefined })
    }
  }
  const nextSend = (sequences ?? []).filter((e) => e.next_send_at).sort((a, b) => a.next_send_at!.localeCompare(b.next_send_at!))[0]
  const nextEmailAt = nextSend?.next_send_at ?? null

  const upcoming = nextSend ? <UpcomingRow title={`${nextSend.sequence_name}, email ${nextSend.sent + 1}`} at={nextSend.next_send_at!} /> : null
  // Replies nobody has answered go above the rest, so they aren't missed.
  const waiting = feed.filter((i) => i.reply && !i.reply.answered)
  const latest = feed.filter((i) => !waiting.includes(i)).slice(0, RECENT)

  const openNote = () => {
    if (view === 'details') setTab('overview')
    if (noteOpen) note.current?.focus()
    else setNoteOpen(true)
  }
  const addNoteButton = !noteOpen && (
    <button type="button" onClick={openNote} className={SECTION_ACTION}>
      <Plus aria-hidden className="h-3.5 w-3.5" />
      Add note
    </button>
  )
  const composer = noteOpen && <NoteComposer ref={note} email={contact.email} name={firstName} onAdded={refresh} onClose={() => setNoteOpen(false)} />

  const handleSendEmail = async () => {
    if (!emailSubject || !emailBody || !canEmail) return
    setIsSendingEmail(true)
    try {
      await sendIndividualEmailFn({ data: { email, subject: emailSubject, htmlContent: emailBody.replace(/\n/g, '<br/>') } })
      setIsEmailModalOpen(false)
      setEmailSubject('')
      setEmailBody('')
      toast.success('Email sent', { description: `To ${email}` })
    } catch (err) {
      console.error('Failed to send email:', err)
      toast.error("Couldn't send the email", { description: err instanceof Error ? err.message : undefined })
    } finally {
      setIsSendingEmail(false)
    }
  }

  const shown = feed.filter((i) => matchesFilter(i, filter))
  const tabs: Array<{ value: Tab; label: string; count?: number; phoneOnly?: boolean }> = [
    { value: 'overview', label: 'Overview' },
    { value: 'details', label: 'Details', phoneOnly: true },
    { value: 'activity', label: 'Activity', count: feed.length },
  ]
  // On a desktop the details are always beside the tabs, so their tab is the Overview.
  const view: Tab = isDesktop && tab === 'details' ? 'overview' : tab

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 animate-in fade-in duration-200">
      <button
        type="button"
        onClick={onClose}
        className="mb-5 inline-flex items-center gap-2 rounded-md-xs text-sm text-muted-foreground hover:text-foreground transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" aria-hidden />
        Back to contacts
      </button>

      <ContactHeader
        contact={contact}
        name={name}
        company={company}
        deals={deals}
        feed={feed}
        nextEmailAt={nextEmailAt}
        repliedAt={
          (sequences ?? [])
            .map((e) => e.replied_at)
            .filter((at): at is string => Boolean(at))
            .sort()
            .at(-1) ?? null
        }
        onEmail={() => setIsEmailModalOpen(true)}
        onNote={openNote}
        onAddTask={() => {
          setTab('overview')
          setAddingTask(true)
        }}
        onShowActivity={() => {
          setFilter('emails')
          setTab('activity')
        }}
        onCopy={() => void copyEmail()}
        onDelete={() => void deleteContact()}
      />

      {!canEmail && (
        <div id="contact-email-blocked">
          <Notice
            level="warning"
            className="mt-4"
            title={`${name || contact.email} is ${status.label.toLowerCase()}`}
            action={
              <Button size="sm" variant="secondary" isLoading={resubscribe.isPending} onClick={() => resubscribe.mutate()}>
                Resubscribe
              </Button>
            }
          >
            {status.text} One-to-one emails from this page won’t send either.
            {resubscribe.error && <span className="block text-destructive">{resubscribe.error.message}</span>}
          </Notice>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <div className={`order-2 lg:order-none ${view === 'details' ? '' : 'hidden lg:block'}`}>
          <ContactSidebar contact={contact} fieldDefs={fieldDefs} company={company} deals={deals} lists={lists} campaigns={campaigns} />
        </div>

        <div className="order-1 lg:order-none min-w-0 space-y-5">
          <div role="tablist" aria-label="Contact" className="flex gap-6 overflow-x-auto border-b border-border [scrollbar-width:none]">
            {tabs.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={view === t.value}
                onClick={() => setTab(t.value)}
                className={`-mb-px shrink-0 items-center gap-1.5 border-b-2 pb-3 pt-1 text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${t.phoneOnly ? 'inline-flex lg:hidden' : 'inline-flex'} ${
                  view === t.value
                    ? 'border-accent font-semibold text-foreground'
                    : 'border-transparent font-medium text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
                {t.count ? (
                  <span className="rounded-full bg-foreground/[0.07] px-1.5 text-xs font-medium text-foreground/80 tabular-nums">{t.count}</span>
                ) : null}
              </button>
            ))}
          </div>

          {view === 'overview' && (
            <>
              <Section
                title="Tasks"
                action={
                  !addingTask && (
                    <button type="button" onClick={() => setAddingTask(true)} className={SECTION_ACTION}>
                      <Plus aria-hidden className="h-3.5 w-3.5" />
                      Add task
                    </button>
                  )
                }
              >
                <RecordTasks on={{ contactEmail: contact.email }} adding={addingTask} onStopAdding={() => setAddingTask(false)} />
              </Section>
              <ContactSequences
                email={contact.email}
                items={sequences ?? []}
                blocked={canEmail ? null : `They’re ${status.label.toLowerCase()}, so sequences skip them.`}
              />
              <Section
                title="Recent activity"
                action={
                  <span className="flex items-center gap-1">
                    {addNoteButton}
                    {feed.length > RECENT && (
                      <button type="button" onClick={() => setTab('activity')} className={SECTION_ACTION}>
                        View all {feed.length}
                        <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                }
              >
                {composer}
                {feed.length === 0 && !nextSend ? (
                  !noteOpen && (
                    <p className="text-sm text-muted-foreground">Nothing has happened with them yet. Emails, replies, forms, surveys and notes show here.</p>
                  )
                ) : (
                  <div className="space-y-4">
                    {upcoming && (
                      <section aria-label="Up next">
                        <FeedLabel>Up next</FeedLabel>
                        <ul className="divide-y divide-border">{upcoming}</ul>
                      </section>
                    )}
                    {waiting.length > 0 && (
                      <section aria-label="Waiting for your reply">
                        <FeedLabel>Waiting for your reply</FeedLabel>
                        <FeedList items={waiting} name={firstName} onChanged={refresh} />
                      </section>
                    )}
                    {latest.length > 0 && (
                      <section aria-label="Latest">
                        <FeedLabel>Latest</FeedLabel>
                        <FeedList items={latest} name={firstName} onChanged={refresh} />
                      </section>
                    )}
                  </div>
                )}
              </Section>
            </>
          )}

          {view === 'activity' && (
            <section aria-label="Activity" className="rounded-xl border border-border bg-card p-5">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SegmentedTabs value={filter} onChange={setFilter} options={FILTERS} label="Show" scroll />
                  {addNoteButton}
                </div>
                {composer}
                {shown.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing of this kind yet.</p>
                ) : (
                  <FeedList items={shown} name={firstName} months onChanged={refresh} before={filter === 'all' || filter === 'emails' ? upcoming : undefined} />
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      <Dialog isOpen={isEmailModalOpen} onClose={() => setIsEmailModalOpen(false)} title={`Email ${name || contact.email}`} className="sm:max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSendEmail()
          }}
        >
          <DialogBody className="space-y-4">
            {!canEmail && (
              <Notice level="warning" title={`${name || 'This contact'} is ${status.label.toLowerCase()}`}>
                This email won’t send. Resubscribe them first, and only if they’ve asked to hear from you again.
              </Notice>
            )}
            <MetaList
              className="-mt-1 border-b border-border pb-4"
              rows={[
                [
                  'From',
                  from ? (
                    <>
                      {from.name ?? from.email}
                      {from.name && <span className="text-muted-foreground"> · {from.email}</span>}
                    </>
                  ) : (
                    'Your default sender'
                  ),
                ],
                ['To', contact.email],
              ]}
            />
            <Field label="Subject">
              <input
                type="text"
                required
                autoFocus={canEmail}
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="e.g. Following up on our call"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Message">
              <textarea
                required
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={7}
                placeholder="Write your message…"
                className={`${INPUT_CLASS} resize-none leading-relaxed`}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setIsEmailModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSendingEmail} disabled={!canEmail}>
              Send email
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  )
}
