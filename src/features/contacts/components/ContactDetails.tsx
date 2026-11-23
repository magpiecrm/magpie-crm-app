import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getContactDetailsFn, getDefaultSenderFn, sendIndividualEmailFn } from '../../../server/functions'
import { Dialog, DialogBody, DialogFooter, MetaList } from '../../../components/ui/Dialog'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { toast } from '../../../components/ui/toast'
import { Button } from '../../../components/ui/Button'
import { Section } from '../../../components/ui/RecordSection'
import { SegmentedTabs } from '../../templates/components/SegmentedTabs'
import { RecordTasks } from '../../sales/components/TaskParts'
import { ContactSequences } from '../../sequences/components/ContactSequences'
import { buildFeed, matchesFilter, type FeedFilter } from '../record'
import { ContactSurveysTab } from './ContactSurveysTab'
import { ContactHeader } from './record/ContactHeader'
import { ContactSidebar, emailStatus } from './record/ContactSidebar'
import { FeedList, NoteComposer, type NoteComposerHandle } from './record/ContactFeed'

interface ContactDetailsProps {
  email: string
  onClose: () => void
}

type Tab = 'overview' | 'activity' | 'surveys'

/** How many of the latest items the Overview shows before "View all". */
const RECENT = 5

const FILTERS: Array<{ value: FeedFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'emails', label: 'Emails' },
  { value: 'notes', label: 'Notes' },
  { value: 'forms', label: 'Forms and surveys' },
]

export function ContactDetails({ email, onClose }: ContactDetailsProps) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [filter, setFilter] = useState<FeedFilter>('all')
  const note = useRef<NoteComposerHandle>(null)
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false)
  // Who the email comes from: the workspace's default sender, as sending uses it.
  const { data: fromData } = useQuery({ queryKey: queryKeys.email.defaultSender(), queryFn: () => getDefaultSenderFn(), enabled: isEmailModalOpen })
  // `"Alex Morgan" <alex@acme.com>` → name and address.
  const fromMatch = fromData?.sender?.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  const from = fromData?.sender ? { name: fromMatch?.[1]?.trim() || null, email: fromMatch?.[2] ?? fromData.sender } : null
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [isSendingEmail, setIsSendingEmail] = useState(false)

  const { data: detailsData, isLoading, error } = useQuery({
    queryKey: queryKeys.email.contact(email),
    queryFn: () => getContactDetailsFn({ data: { email } }),
  })
  const details = detailsData?.success ? detailsData : null
  const feed = useMemo(() => (details ? buildFeed(details.activity, details.notes) : []), [details])
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
        <div className="grid grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)] gap-6">
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

  const { contact, lists, campaigns, fieldDefs, surveyResponses, sequences, company, deals } = details
  const name = `${contact.attributes.FIRSTNAME} ${contact.attributes.LASTNAME}`.trim()
  const firstName = contact.attributes.FIRSTNAME || name || 'them'
  const status = emailStatus(contact.status)
  const canEmail = status.tone === 'good'

  const openNote = () => {
    if (tab === 'surveys') setTab('overview')
    // After the tab has drawn its composer.
    setTimeout(() => note.current?.focus(), 0)
  }

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
  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: 'overview', label: 'Overview' },
    { value: 'activity', label: 'Activity', count: feed.length },
    { value: 'surveys', label: 'Surveys', count: surveyResponses.length },
  ]

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

      <ContactHeader contact={contact} name={name} company={company} onEmail={() => setIsEmailModalOpen(true)} onNote={openNote} />

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <ContactSidebar contact={contact} fieldDefs={fieldDefs} company={company} deals={deals} lists={lists} campaigns={campaigns} />

        <div className="min-w-0 space-y-5">
          <div role="tablist" aria-label="Contact" className="flex gap-6 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={tab === t.value}
                onClick={() => setTab(t.value)}
                className={`-mb-px inline-flex items-center gap-1.5 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  tab === t.value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
                {t.count ? <span className="rounded-full bg-foreground/[0.07] px-1.5 text-xs font-medium text-muted-foreground tabular-nums">{t.count}</span> : null}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <>
              <Section title="Tasks">
                <RecordTasks on={{ contactEmail: contact.email }} />
              </Section>
              <ContactSequences email={contact.email} items={sequences ?? []} />
              <Section
                title="Recent activity"
                action={
                  feed.length > RECENT && (
                    <button type="button" onClick={() => setTab('activity')} className="text-xs font-semibold text-accent hover:underline cursor-pointer">
                      View all {feed.length}
                    </button>
                  )
                }
              >
                <NoteComposer ref={note} email={contact.email} name={firstName} onAdded={refresh} />
                {feed.length === 0 ? (
                  <p className="pt-4 text-sm text-muted-foreground">Nothing has happened with them yet. Emails, replies, forms, surveys and notes show here.</p>
                ) : (
                  <div className="mt-2">
                    <FeedList items={feed.slice(0, RECENT)} onChanged={refresh} />
                  </div>
                )}
              </Section>
            </>
          )}

          {tab === 'activity' && (
            <Section title="Activity" count={feed.length}>
              <div className="space-y-4">
                <NoteComposer ref={note} email={contact.email} name={firstName} onAdded={refresh} />
                <SegmentedTabs value={filter} onChange={setFilter} options={FILTERS} label="Show" scroll />
                {shown.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing of this kind yet.</p>
                ) : (
                  <FeedList items={shown} months onChanged={refresh} />
                )}
              </div>
            </Section>
          )}

          {tab === 'surveys' && <ContactSurveysTab responses={surveyResponses} />}
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
              <input type="text" required autoFocus={canEmail} value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="e.g. Following up on our call" className={INPUT_CLASS} />
            </Field>
            <Field label="Message">
              <textarea required value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={7} placeholder="Write your message…" className={`${INPUT_CLASS} resize-none leading-relaxed`} />
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
