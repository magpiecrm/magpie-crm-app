import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { Laptop, Smartphone, Search, Check, Loader2 } from 'lucide-react'
import { contactsFn, getContactFieldsFn, sendTestEmailFn } from '../server/functions'
import { mergeContact, unfilledMergeTags } from '../server/mergeTags'
import { Notice } from './ui/Notice'
import { Button } from './ui/Button'
import { Dialog, MetaList } from './ui/Dialog'
import { Field, INPUT_CLASS } from './ui/Field'
import { toast } from './ui/toast'

/** A list that scrolls, its last rows fading while there's more below. */
function ScrollList({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const measure = () => {
    const el = ref.current
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4)
  }
  useEffect(() => {
    measure()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  })
  return (
    <div className={`flex min-h-[180px] flex-1 flex-col overflow-hidden rounded-md-s border border-border ${className}`}>
      <div
        ref={ref}
        onScroll={measure}
        className={`min-h-0 flex-1 overflow-y-auto custom-scrollbar divide-y divide-border ${more ? '[mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]' : ''}`}
      >
        {children}
      </div>
    </div>
  )
}

interface PreviewTestModalProps {
  isOpen: boolean
  onClose: () => void
  htmlContent: string
  campaignSubject: string
  campaignSender: { name: string; email: string }
  campaignPreviewText?: string
  /** The campaign's spam score card, shown above the settings. */
  spamScore?: ReactNode
}

export function PreviewTestModal({
  isOpen,
  onClose,
  htmlContent,
  campaignSubject,
  campaignSender,
  campaignPreviewText,
  spamScore,
}: PreviewTestModalProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'send'>('preview')
  // On a phone, start with the phone-sized preview.
  const canvasRef = useRef<HTMLDivElement>(null)
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 'mobile' : 'desktop',
  )
  const [selectedContact, setSelectedContact] = useState<any | null>(null)
  
  // Search state for Preview tab
  const [searchQuery, setSearchQuery] = useState('')
  
  // Test Email state
  const [testRecipientInput, setTestRecipientInput] = useState('')
  const [selectedTestRecipients, setSelectedTestRecipients] = useState<string[]>([])
  
  // Load contacts
  const { data: contactFields = [] } = useQuery({ queryKey: queryKeys.email.contactFields(), queryFn: () => getContactFieldsFn(), enabled: isOpen })
  const unfilled = isOpen ? unfilledMergeTags(`${campaignSubject}\n${campaignPreviewText ?? ''}\n${htmlContent}`, contactFields.map((f) => f.key)) : []

  const { data: contactsData, isLoading: isLoadingContacts } = useQuery({
    queryKey: queryKeys.email.contactsAll(),
    queryFn: () => contactsFn(),
    enabled: isOpen
  })

  // Send Test Email Mutation
  const sendTestMutation = useMutation({
    mutationFn: (recipients: string[]) =>
      sendTestEmailFn({
        data: {
          sender: campaignSender,
          to: recipients,
          subject: `[TEST] ${campaignSubject || 'No Subject'}`,
          htmlContent: replacePlaceholders(htmlContent, selectedContact, true),
          previewText: getPreviewText() || undefined
        }
      }),
    onSuccess: (_res, recipients) => {
      toast.success(recipients.length === 1 ? 'Test email sent' : `Test email sent to ${recipients.length} addresses`, { description: recipients.join(', ') })
      setTestRecipientInput('')
    },
  })
  const [recipientError, setRecipientError] = useState<string | null>(null)

  if (!isOpen) return null

  const contacts = contactsData?.contacts || []

  // Filter contacts based on search query
  const filteredContacts = contacts.filter((c: any) => {
    const email = (c.email || '').toLowerCase()
    const firstName = (c.attributes?.FIRSTNAME || '').toLowerCase()
    const lastName = (c.attributes?.LASTNAME || '').toLowerCase()
    const term = searchQuery.toLowerCase().trim()
    return email.includes(term) || firstName.includes(term) || lastName.includes(term)
  })

  // Utility to replace placeholders
  function replacePlaceholders(text: string, contact: any, html = false): string {
    if (!contact) return text
    const a = contact.attributes || {}
    return mergeContact(text, { email: contact.email, first_name: a.FIRSTNAME, last_name: a.LASTNAME, company: a.COMPANY, custom: contact.custom }, { html })
  }

  // The campaign's preview text, merged for the chosen contact. Without one, inboxes show the start of the email.
  function getPreviewText() {
    return campaignPreviewText ? replacePlaceholders(campaignPreviewText, selectedContact) : ''
  }

  const handleSendTest = () => {
    const list: string[] = []
    if (testRecipientInput.trim()) {
      // Split by comma or semicolon and clean up
      const typed = testRecipientInput.split(/[,;]+/).map(e => e.trim()).filter(e => e.includes('@'))
      list.push(...typed)
    }
    list.push(...selectedTestRecipients)

    if (list.length === 0) {
      setRecipientError('Enter an email address, or choose a contact below.')
      return
    }
    setRecipientError(null)
    sendTestMutation.mutate(list)
  }

  const toggleTestRecipient = (email: string) => {
    if (selectedTestRecipients.includes(email)) {
      setSelectedTestRecipients(selectedTestRecipients.filter(e => e !== email))
    } else {
      setSelectedTestRecipients([...selectedTestRecipients, email])
    }
  }

  const tabClass = (on: boolean) =>
    `inline-flex h-7 items-center justify-center rounded-[6px] px-3 text-[13px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${on ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground'}`
  const contactName = (c: any) => `${c.attributes?.FIRSTNAME || ''} ${c.attributes?.LASTNAME || ''}`.trim()
  const rowClass = (on: boolean) =>
    `flex w-full items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer ${on ? 'bg-accent/[0.07]' : 'hover:bg-muted/50'}`
  const listBox = ''

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      className="sm:max-w-6xl sm:h-[88dvh]"
      title="Preview and test"
      footer={
        activeTab === 'send' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="preview-send-test" isLoading={sendTestMutation.isPending}>
              Send test email
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border lg:flex-row lg:overflow-hidden">
        {/* The email, as an inbox shows it */}
        <div className="flex min-w-0 flex-1 flex-col lg:border-r border-border">
          <div className="flex shrink-0 items-start gap-4 border-b border-border px-5 sm:px-6 py-4">
            <MetaList
              className="min-w-0 flex-1"
              rows={[
                [
                  'From',
                  campaignSender?.email ? (
                    <>
                      {campaignSender.name || campaignSender.email}
                      {campaignSender.name && <span className="text-muted-foreground"> · {campaignSender.email}</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Not chosen yet</span>
                  ),
                ],
                ['Subject', replacePlaceholders(campaignSubject, selectedContact) || <span className="text-muted-foreground">Not set</span>],
                ['Preview text', getPreviewText() || <span className="text-muted-foreground">Not set (inboxes show the email's first line)</span>],
              ]}
            />
            <div className="flex shrink-0 items-center rounded-md-s bg-muted p-0.5" role="group" aria-label="Preview size">
              <button type="button" onClick={() => setPreviewMode('desktop')} aria-pressed={previewMode === 'desktop'} aria-label="Desktop" title="Desktop" className={`${tabClass(previewMode === 'desktop')} !px-2.5`}>
                <Laptop className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setPreviewMode('mobile')} aria-pressed={previewMode === 'mobile'} aria-label="Phone" title="Phone" className={`${tabClass(previewMode === 'mobile')} !px-2.5`}>
                <Smartphone className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Desktop: the email edge to edge, as an inbox's reading pane shows it. Phone: a phone-width column. */}
          <div
            ref={canvasRef}
            className={`flex min-h-[360px] flex-1 items-start justify-center overflow-y-auto custom-scrollbar ${previewMode === 'desktop' ? 'bg-white' : 'bg-muted/50 p-3 sm:p-6'}`}
          >
            <div className={previewMode === 'desktop' ? 'w-full' : 'w-full max-w-[375px] overflow-hidden rounded-md-s border border-border bg-white shadow-sm'}>
              <iframe
                key={previewMode}
                sandbox="allow-same-origin"
                srcDoc={replacePlaceholders(htmlContent, selectedContact, true)}
                title="Email preview"
                className="block w-full min-h-[320px] border-none"
                // As tall as the email (or the pane, if that's taller), so the pane scrolls rather than a box inside it.
                onLoad={(e) => {
                  const doc = e.currentTarget.contentDocument
                  const pane = canvasRef.current?.clientHeight ?? 0
                  if (doc) e.currentTarget.style.height = `${Math.max(doc.documentElement.scrollHeight, previewMode === 'desktop' ? pane : 0)}px`
                }}
              />
            </div>
          </div>
        </div>

        {/* Who it's previewed as, and sending a test */}
        <div className="flex w-full shrink-0 flex-col gap-4 border-t border-border bg-card px-5 py-5 sm:px-6 lg:w-[380px] lg:overflow-y-auto lg:border-t-0 custom-scrollbar">
          {spamScore}
          <div className="flex rounded-md-s bg-muted p-0.5" role="tablist" aria-label="Preview or send a test">
            <button type="button" role="tab" aria-selected={activeTab === 'preview'} onClick={() => setActiveTab('preview')} className={`${tabClass(activeTab === 'preview')} flex-1`}>
              Preview as a contact
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'send'} onClick={() => setActiveTab('send')} className={`${tabClass(activeTab === 'send')} flex-1`}>
              Send a test
            </button>
          </div>

          {unfilled.length > 0 && (
            <Notice level="warning">This won't send until these are fixed: {unfilled.join(', ')}. They aren't contact fields.</Notice>
          )}

          {activeTab === 'preview' && (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div>
                <p className="text-[13px] leading-5 text-muted-foreground">
                  {selectedContact ? (
                    <>
                      Showing {contactName(selectedContact) || selectedContact.email}'s details in the merge tags.{' '}
                      <button type="button" onClick={() => setSelectedContact(null)} className="font-medium text-foreground underline underline-offset-2 cursor-pointer">
                        Clear
                      </button>
                    </>
                  ) : (
                    'Choose a contact to see their details in place of the merge tags.'
                  )}
                </p>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input type="search" placeholder="Search contacts" aria-label="Search contacts" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className={`${INPUT_CLASS} pl-9`} />
              </div>
              <ScrollList className={listBox}>
                {isLoadingContacts ? (
                  <div className="flex items-center justify-center gap-2 p-8 text-[13px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading contacts…
                  </div>
                ) : filteredContacts.length === 0 ? (
                  <div className="p-8 text-center text-[13px] text-muted-foreground">No contacts match.</div>
                ) : (
                  filteredContacts.map((contact: any) => {
                    const isSelected = selectedContact?.email === contact.email
                    const name = contactName(contact)
                    return (
                      <button key={contact.email} type="button" onClick={() => setSelectedContact(isSelected ? null : contact)} aria-pressed={isSelected} className={rowClass(isSelected)}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium leading-5 text-foreground">{name || contact.email}</p>
                          {name && <p className="truncate text-[13px] leading-[18px] text-muted-foreground">{contact.email}</p>}
                        </div>
                        {isSelected && <Check className="h-4 w-4 shrink-0 text-accent" />}
                      </button>
                    )
                  })
                )}
              </ScrollList>
            </div>
          )}

          {activeTab === 'send' && (
            <form
              id="preview-send-test"
              className="flex min-h-0 flex-1 flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                handleSendTest()
              }}
            >
              <Field label="Send to" hint="Separate addresses with commas." error={recipientError ?? (sendTestMutation.error as Error | null)?.message}>
                <input
                  type="text"
                  inputMode="email"
                  placeholder="e.g. you@example.com"
                  value={testRecipientInput}
                  onChange={(e) => setTestRecipientInput(e.target.value)}
                  className={INPUT_CLASS}
                />
              </Field>
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <p className="text-[13px] font-medium text-foreground">Or choose contacts</p>
                <ScrollList className={listBox}>
                  {isLoadingContacts ? (
                    <div className="flex items-center justify-center gap-2 p-8 text-[13px] text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading contacts…
                    </div>
                  ) : contacts.length === 0 ? (
                    <div className="p-8 text-center text-[13px] text-muted-foreground">No contacts yet.</div>
                  ) : (
                    contacts.map((contact: any) => {
                      const isSelected = selectedTestRecipients.includes(contact.email)
                      return (
                        <label key={contact.email} className={rowClass(isSelected)}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleTestRecipient(contact.email)} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{contact.email}</span>
                        </label>
                      )
                    })
                  )}
                </ScrollList>
              </div>
            </form>
          )}
        </div>
      </div>
    </Dialog>
  )
}
