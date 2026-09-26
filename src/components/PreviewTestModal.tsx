import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { User, Send, Laptop, Smartphone, Search, Check, Loader2 } from 'lucide-react'
import { contactsFn, sendTestEmailFn } from '../server/functions'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'

interface PreviewTestModalProps {
  isOpen: boolean
  onClose: () => void
  htmlContent: string
  campaignSubject: string
  campaignSender: { name: string; email: string }
  campaignPreviewText?: string
}

export function PreviewTestModal({
  isOpen,
  onClose,
  htmlContent,
  campaignSubject,
  campaignSender,
  campaignPreviewText
}: PreviewTestModalProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'send'>('preview')
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [selectedContact, setSelectedContact] = useState<any | null>(null)
  
  // Search state for Preview tab
  const [searchQuery, setSearchQuery] = useState('')
  
  // Test Email state
  const [testRecipientInput, setTestRecipientInput] = useState('')
  const [selectedTestRecipients, setSelectedTestRecipients] = useState<string[]>([])
  
  // Load contacts
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
          htmlContent: replacePlaceholders(htmlContent, selectedContact),
          previewText: getPreviewText()
        }
      }),
    onSuccess: () => {
      alert('Test email sent successfully!')
      setTestRecipientInput('')
    },
    onError: (err: any) => {
      alert(`Failed to send test email: ${err.message}`)
    }
  })

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
  function replacePlaceholders(html: string, contact: any): string {
    if (!contact) return html
    let processed = html
    const attributes = contact.attributes || {}
    
    // Core attributes replacement
    processed = processed.replace(/\{\{\s*contact\.FIRSTNAME\s*\}\}/gi, attributes.FIRSTNAME || '')
    processed = processed.replace(/\{\{\s*contact\.LASTNAME\s*\}\}/gi, attributes.LASTNAME || '')
    processed = processed.replace(/\{\{\s*contact\.EMAIL\s*\}\}/gi, contact.email || '')
    processed = processed.replace(/\{\{\s*contact\.COMPANY\s*\}\}/gi, attributes.COMPANY || '')
    processed = processed.replace(/\{\{\s*contact\.JOB_TITLE\s*\}\}/gi, attributes.JOB_TITLE || '')
    
    // Extra/Dynamic attribute replacement mapping
    processed = processed.replace(/\{\{\s*contact\.([A-Za-z0-9_]+)\s*\}\}/gi, (match, fieldName) => {
      const key = fieldName.toUpperCase()
      if (attributes[key] !== undefined) return String(attributes[key])
      if (attributes[fieldName] !== undefined) return String(attributes[fieldName])
      if (key === 'EMAIL') return contact.email || ''
      return match
    })
    
    return processed
  }

  // Get preview text line (fallback to stripping HTML)
  function getPreviewText() {
    const baseText = campaignPreviewText || "Hey! {{ contact.FIRSTNAME }}. You probably have more tools than you need and a gap you are filling manually. Here is how to find it."
    return replacePlaceholders(baseText, selectedContact)
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
      alert('Please select or enter at least one valid recipient email.')
      return
    }

    sendTestMutation.mutate(list)
  }

  const toggleTestRecipient = (email: string) => {
    if (selectedTestRecipients.includes(email)) {
      setSelectedTestRecipients(selectedTestRecipients.filter(e => e !== email))
    } else {
      setSelectedTestRecipients([...selectedTestRecipients, email])
    }
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-6xl h-[88vh]"
      title={
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xl font-bold text-foreground">Preview & test</h3>
          
          {/* Tabs */}
          <div className="flex gap-4 mt-1">
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-2 pb-2 text-sm font-semibold transition-all border-b-2 px-1 ${
                activeTab === 'preview'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <User className="w-4 h-4" />
              Preview
            </button>
            <button
              onClick={() => setActiveTab('send')}
              className={`flex items-center gap-2 pb-2 text-sm font-semibold transition-all border-b-2 px-1 ${
                activeTab === 'send'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Send className="w-4 h-4" />
              Send test email
            </button>
          </div>
        </div>
      }
    >
      {/* Two Column Layout Body */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 bg-muted/20">
        
        {/* LEFT COLUMN: The Email Display Frame */}
        <div className="flex-1 flex flex-col lg:border-r border-border min-w-0 bg-muted/10">
          {/* Metadata bar */}
          <div className="p-5 border-b border-border bg-card shrink-0 space-y-2 relative">
            
            {/* Desktop/Mobile toggles - absolutely positioned at the top-right of metadata bar */}
            <div className="absolute right-5 top-5 border border-border rounded-lg p-0.5 bg-muted flex items-center shrink-0">
              <button
                onClick={() => setPreviewMode('desktop')}
                className={`p-1.5 rounded-md transition-colors ${
                  previewMode === 'desktop'
                    ? 'bg-card text-accent shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Desktop View"
              >
                <Laptop className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPreviewMode('mobile')}
                className={`p-1.5 rounded-md transition-colors ${
                  previewMode === 'mobile'
                    ? 'bg-card text-accent shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Mobile View"
              >
                <Smartphone className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs space-y-1.5 pr-24">
              <div>
                <span className="font-bold text-muted-foreground inline-block w-16">From:</span>
                <span className="text-foreground">{campaignSender?.email || 'sender@example.com'}</span>
              </div>
              <div>
                <span className="font-bold text-muted-foreground inline-block w-16">Subject:</span>
                <span className="text-foreground">{campaignSubject || 'Is your stack built around functions or just features?'}</span>
              </div>
              <div className="flex items-start">
                <span className="font-bold text-muted-foreground inline-block w-16 shrink-0">Preview:</span>
                <span className="text-foreground italic">{getPreviewText()}</span>
              </div>
            </div>
          </div>

          {/* Scrollable Frame Area */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-6 flex justify-center items-start bg-[#f3f4f6]">
            <div
              className={`w-full bg-white rounded-lg shadow-lg overflow-hidden border border-border transition-all duration-300 ${
                previewMode === 'desktop' ? 'max-w-[650px]' : 'max-w-[375px]'
              }`}
            >
              <iframe
                sandbox="allow-same-origin"
                srcDoc={replacePlaceholders(htmlContent, selectedContact)}
                title="Compiled Test Output"
                className="w-full min-h-[500px] border-none"
                style={{ height: '58vh' }}
              />

            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Configuration Side Pane */}
        <div className="w-full lg:w-[380px] shrink-0 overflow-y-auto bg-card p-4 sm:p-6 flex flex-col justify-between border-t lg:border-t-0 border-border">
          
          {/* Tab: Preview configurations */}
          {activeTab === 'preview' && (
            <div className="space-y-5 flex-1 flex flex-col min-h-0">
              <div>
                <h4 className="font-bold text-foreground text-base">Who would you like to preview this email as?</h4>
                <p className="text-xs text-muted-foreground mt-1">Select a contact to view dynamic personalization tags replaced with their details.</p>
              </div>

              <div className="space-y-3 flex-1 flex flex-col min-h-0">
                <span className="block text-xs font-bold text-muted-foreground uppercase tracking-wider">Select a contact</span>
                
                {/* Search Bar */}
                <div className="relative">
                  <Search className="w-4.5 h-4.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by email"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-muted/40 border border-border rounded-xl text-sm text-foreground focus:ring-1 focus:ring-accent outline-none"
                  />
                </div>

                {/* Contact Results List */}
                <div className="flex-1 border border-border rounded-xl overflow-y-auto min-h-0 divide-y divide-border bg-card">
                  {isLoadingContacts ? (
                    <div className="p-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-accent" /> Loading contacts...
                    </div>
                  ) : filteredContacts.length === 0 ? (
                    <div className="p-8 text-center text-xs text-muted-foreground">
                      No contacts found
                    </div>
                  ) : (
                    filteredContacts.map((contact: any) => {
                      const isSelected = selectedContact?.email === contact.email
                      const name = `${contact.attributes?.FIRSTNAME || ''} ${contact.attributes?.LASTNAME || ''}`.trim()
                      return (
                        <button
                          key={contact.email}
                          onClick={() => setSelectedContact(isSelected ? null : contact)}
                          className={`w-full p-3 text-left transition-colors flex items-center justify-between text-xs ${
                            isSelected ? 'bg-accent/5 font-semibold' : 'hover:bg-muted/30'
                          }`}
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <p className="text-foreground truncate">{contact.email}</p>
                            {name && <p className="text-muted-foreground text-[10px] mt-0.5 truncate">{name}</p>}
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-accent shrink-0" />}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Selected Contact Preview Card */}
              {selectedContact && (
                <div className="p-3 bg-accent/5 border border-accent/20 rounded-xl space-y-1">
                  <p className="text-[10px] font-bold text-accent uppercase tracking-wider">Viewing personalization as:</p>
                  <p className="text-xs text-foreground font-semibold truncate">{selectedContact.email}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Name: {selectedContact.attributes?.FIRSTNAME || 'N/A'} {selectedContact.attributes?.LASTNAME || 'N/A'}
                  </p>
                  <button
                    onClick={() => setSelectedContact(null)}
                    className="text-[10px] text-red-500 hover:text-red-700 font-semibold underline block pt-1"
                  >
                    Clear Selection
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab: Send configurations */}
          {activeTab === 'send' && (
            <div className="space-y-5 flex-1 flex flex-col min-h-0">
              <div>
                <h4 className="font-bold text-foreground text-base">Who do you want to test your email with?</h4>
                <p className="text-xs text-muted-foreground mt-1">Send your email to selected recipients in your test list.</p>
              </div>

              <div className="space-y-4 flex-1 flex flex-col min-h-0">
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider">Enter recipient email(s) *</label>
                  <input
                    type="text"
                    placeholder="e.g. test@example.com, developer@example.com"
                    value={testRecipientInput}
                    onChange={(e) => setTestRecipientInput(e.target.value)}
                    className="w-full px-4 py-2.5 bg-muted/40 border border-border rounded-xl text-sm text-foreground focus:ring-1 focus:ring-accent outline-none"
                  />
                  <p className="text-[10px] text-muted-foreground">Separate multiple emails with commas.</p>
                </div>

                <div className="flex-1 flex flex-col min-h-0 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="block text-xs font-bold text-muted-foreground uppercase tracking-wider">Or Select from Contacts</span>
                    <a href="/marketing/contacts" className="text-[10px] text-accent hover:underline font-semibold">Manage test list</a>
                  </div>
                  
                  {/* Contacts select list */}
                  <div className="flex-1 border border-border rounded-xl overflow-y-auto min-h-0 divide-y divide-border bg-card">
                    {isLoadingContacts ? (
                      <div className="p-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-accent" /> Loading contacts...
                      </div>
                    ) : contacts.length === 0 ? (
                      <div className="p-8 text-center text-xs text-muted-foreground">
                        No contacts available
                      </div>
                    ) : (
                      contacts.map((contact: any) => {
                        const isSelected = selectedTestRecipients.includes(contact.email)
                        return (
                          <button
                            key={contact.email}
                            onClick={() => toggleTestRecipient(contact.email)}
                            className={`w-full p-2.5 text-left transition-colors flex items-center justify-between text-xs ${
                              isSelected ? 'bg-accent/5 font-semibold' : 'hover:bg-muted/30'
                            }`}
                          >
                            <span className="text-foreground truncate pr-2">{contact.email}</span>
                            {isSelected && <Check className="w-4 h-4 text-accent shrink-0" />}
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-border shrink-0">
                <Button
                  onClick={handleSendTest}
                  isLoading={sendTestMutation.isPending}
                  className="w-full py-3"
                >
                  Send Test
                </Button>
              </div>
            </div>
          )}

        </div>

      </div>
    </Dialog>
  )
}
