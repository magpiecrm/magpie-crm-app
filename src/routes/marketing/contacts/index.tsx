import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { useState, useMemo } from 'react'
import { 
  contactsFn, 
  listsFn, 
  listContactsFn,
  createContactFn,
  deleteContactsFn,
  getContactFieldsFn
} from '../../../server/functions'
import { 
  Search, 
  Loader2, 
  ChevronDown, 
  Mail, 
  SlidersHorizontal,
  X,
  ArrowLeft,
  Trash2,
  BellOff,
  AlertTriangle,
  HelpCircle,
  Repeat
} from 'lucide-react'
import { Avatar } from '../../../components/ui/Avatar'
import { Pagination } from '../../../components/ui/Pagination'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { ContactDetails } from '../../../features/contacts/components/ContactDetails'
import { contactExportColumnsWith, type ExportableContact } from '../../../features/contacts/exportColumns'
import { Select } from '../../../components/ui/Select'
import { EnrollDialog } from '../../../features/sequences/components/EnrollDialog'

export const Route = createFileRoute('/marketing/contacts/')({
  // ?contact=<email> opens that contact (links from tasks and their reminders).
  validateSearch: (search: Record<string, unknown>): { contact?: string } =>
    typeof search.contact === 'string' && search.contact ? { contact: search.contact } : {},
  component: ContactsPage,
})

// Reflects `contacts.status` from the DB. This column previously rendered a
// hardcoded green badge for every row, so unsubscribed and bounced contacts
// looked subscribed — which hid the reason a campaign sent to nobody.
// Campaign sends select `status = 'subscribed'`, so anything else is excluded.
function SubscriptionBadge({ status }: { status?: string }) {
  const styles = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border'

  switch (status) {
    case 'subscribed':
      return (
        <span className={`${styles} bg-emerald-500/10 text-emerald-600 border-emerald-500/10`}>
          <Mail className="w-3 h-3" />
          Subscribed
        </span>
      )
    case 'unsubscribed':
      return (
        <span className={`${styles} bg-amber-500/10 text-amber-600 border-amber-500/10`}>
          <BellOff className="w-3 h-3" />
          Unsubscribed
        </span>
      )
    case 'bounced':
      return (
        <span className={`${styles} bg-red-500/10 text-red-600 border-red-500/10`}>
          <AlertTriangle className="w-3 h-3" />
          Bounced
        </span>
      )
    default:
      // Never silently render an unknown status as subscribed.
      return (
        <span className={`${styles} bg-muted text-muted-foreground border-border`}>
          <HelpCircle className="w-3 h-3" />
          {status || 'Unknown'}
        </span>
      )
  }
}

function ContactsPage() {
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const { contact: linkedContact } = Route.useSearch()
  const [selectedContactEmail, setSelectedContactEmail] = useState<string | null>(linkedContact ?? null)
  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [showListDropdown, setShowListDropdown] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)
  const [selectedEmails, setSelectedEmails] = useState<string[]>([])

  // Drawer Form State
  const [showDrawer, setShowDrawer] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [company, setCompany] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [emailAddress, setEmailAddress] = useState('')
  const [sms, setSms] = useState('')
  const [landline, setLandline] = useState('')
  const [extId, setExtId] = useState('')
  const [doubleOptIn, setDoubleOptIn] = useState('')
  const [selectedListIds, setSelectedListIds] = useState<number[]>([])
  const [optIn, setOptIn] = useState('')

  const createContactMutation = useMutation({
    mutationFn: (data: { email: string; attributes: any; listIds?: number[] }) => 
      createContactFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.contacts() })
      setShowDrawer(false)
      // reset form
      setFirstName('')
      setLastName('')
      setCompany('')
      setJobTitle('')
      setEmailAddress('')
      setSms('')
      setLandline('')
      setExtId('')
      setDoubleOptIn('')
      setSelectedListIds([])
      setOptIn('')
      alert('Contact created successfully!')
    },
    onError: (err: any) => {
      alert(`Failed to create contact: ${err.message}`)
    }
  })

  const deleteContactsMutation = useMutation({
    mutationFn: (emails: string[]) => deleteContactsFn({ data: { emails } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.contacts() })
      queryClient.invalidateQueries({ queryKey: queryKeys.email.contactsAll() })
      if (selectedListId !== null) {
        queryClient.invalidateQueries({ queryKey: queryKeys.email.contactsByList(selectedListId) })
      }
      setSelectedEmails([])
      alert('Selected contacts deleted successfully!')
    },
    onError: (err: any) => {
      alert(`Failed to delete contacts: ${err.message}`)
    }
  })

  // Fetch all lists for the dropdown filter
  const { data: listsData } = useQuery({
    queryKey: queryKeys.email.lists(),
    queryFn: () => listsFn(),
  })

  const { data: contactFields = [] } = useQuery({
    queryKey: queryKeys.email.contactFields(),
    queryFn: () => getContactFieldsFn(),
  })

  // Fetch all contacts
  const { data: allContactsData, isLoading: isLoadingAllContacts } = useQuery({
    queryKey: queryKeys.email.contactsAll(),
    queryFn: () => contactsFn(),
    enabled: selectedListId === null,
  })

  // Fetch contacts for a specific list if selected
  const { data: listContactsData, isLoading: isLoadingListContacts } = useQuery({
    queryKey: queryKeys.email.contactsByList(selectedListId),
    queryFn: () => listContactsFn({ data: { listId: selectedListId! } }),
    enabled: selectedListId !== null,
  })

  const lists = listsData?.lists || []
  
  // Decide which data source to use
  const rawContacts = selectedListId !== null 
    ? listContactsData?.contacts || [] 
    : allContactsData?.contacts || []

  const isLoading = selectedListId !== null ? isLoadingListContacts : isLoadingAllContacts

  // Client-side search filtering
  const contacts = useMemo(() => {
    if (!searchTerm.trim()) return rawContacts
    const term = searchTerm.toLowerCase()
    return rawContacts.filter((c: any) => {
      const email = (c.email || '').toLowerCase()
      const firstName = (c.attributes?.FIRSTNAME || '').toLowerCase()
      const lastName = (c.attributes?.LASTNAME || '').toLowerCase()
      const company = (c.attributes?.COMPANY || '').toLowerCase()
      const jTitle = (c.attributes?.JOB_TITLE || '').toLowerCase()
      return email.includes(term) || firstName.includes(term) || lastName.includes(term) || company.includes(term) || jTitle.includes(term)
    })
  }, [rawContacts, searchTerm])

  // Reset page when search or list changes
  useMemo(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedListId])

  // Slice contacts for current page
  const paginatedContacts = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return contacts.slice(startIndex, startIndex + itemsPerPage)
  }, [contacts, currentPage, itemsPerPage])

  const isAllSelected = useMemo(() => {
    return paginatedContacts.length > 0 && paginatedContacts.every((c: any) => selectedEmails.includes(c.email))
  }, [paginatedContacts, selectedEmails])

  const isSomeSelected = useMemo(() => {
    return paginatedContacts.some((c: any) => selectedEmails.includes(c.email)) && !isAllSelected
  }, [paginatedContacts, selectedEmails, isAllSelected])

  const selectedListName = selectedListId !== null
    ? lists.find((l: any) => l.id === selectedListId)?.name || `List #${selectedListId}`
    : 'Load a list or a segment'

  // Export whatever the user is currently looking at: the selected rows if
  // there is a selection, otherwise the full search/list-filtered set (not just
  // the current page).
  const exportRows: ExportableContact[] = useMemo(() => {
    if (selectedEmails.length === 0) return contacts
    return contacts.filter((c: any) => selectedEmails.includes(c.email))
  }, [contacts, selectedEmails])

  const exportName = selectedEmails.length > 0
    ? 'contacts_selected'
    : selectedListId !== null
      ? `contacts_${selectedListName}`
      : 'contacts'

  // Render the contact creation form directly in the viewport if showDrawer is active
  if (showDrawer) {
    return (
      <div className="p-4 lg:p-8 max-w-4xl mx-auto min-h-[100dvh] animate-in fade-in duration-200">
        {/* Breadcrumb Back Link */}
        <div className="mb-6">
          <button
            onClick={() => setShowDrawer(false)}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors group mb-4 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
            Back to contacts
          </button>
        </div>

        {/* Header Panel */}
        <div className="bg-accent/5 dark:bg-accent/10 border border-border rounded-2xl p-6 mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1">Create a contact</h1>
            <p className="text-sm text-muted-foreground">Add a new email subscriber to your marketing campaigns.</p>
          </div>
        </div>

        {/* Grid Form Card */}
        <div className="bg-card border border-border rounded-2xl p-4 lg:p-8 shadow-sm space-y-8">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* FIRSTNAME */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Firstname</label>
              <input 
                type="text" 
                placeholder="Enter the FIRSTNAME"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {/* LASTNAME */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Lastname</label>
              <input 
                type="text" 
                placeholder="Enter the LASTNAME"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {/* COMPANY */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Company</label>
              <input 
                type="text" 
                placeholder="Enter the company name"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {/* JOB_TITLE */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Job Title</label>
              <input 
                type="text" 
                placeholder="Enter the job title"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {/* EMAIL */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Email *</label>
              <input 
                type="email" 
                placeholder="Enter the email address"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                required
              />
            </div>

            {/* SMS */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Sms</label>
              <div className="flex items-center border border-border rounded-xl bg-background overflow-hidden px-3 gap-2 focus-within:ring-2 focus-within:ring-accent">
                <span className="text-sm shrink-0 select-none flex items-center gap-1.5 font-medium border-r border-border/80 pr-2">
                  🇬🇧 +44
                </span>
                <input 
                  type="tel" 
                  placeholder="7123456789"
                  value={sms}
                  onChange={(e) => setSms(e.target.value)}
                  className="w-full py-2.5 text-sm bg-transparent text-foreground focus:outline-none"
                />
              </div>
            </div>

            {/* LANDLINE */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Landline_number</label>
              <div className="flex items-center border border-border rounded-xl bg-background overflow-hidden px-3 gap-2 focus-within:ring-2 focus-within:ring-accent">
                <span className="text-sm shrink-0 select-none flex items-center gap-1.5 font-medium border-r border-border/80 pr-2">
                  🇬🇧 +44
                </span>
                <input 
                  type="tel" 
                  placeholder="2012345678"
                  value={landline}
                  onChange={(e) => setLandline(e.target.value)}
                  className="w-full py-2.5 text-sm bg-transparent text-foreground focus:outline-none"
                />
              </div>
            </div>

            {/* EXT_ID */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-baseline">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Ext_id</label>
                <span className="text-[10px] text-muted-foreground/60 font-mono">{extId.length}/254</span>
              </div>
              <input 
                type="text" 
                placeholder="Some text here"
                maxLength={254}
                value={extId}
                onChange={(e) => setExtId(e.target.value)}
                className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {/* DOUBLE_OPT-IN */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Double_opt-in</label>
              <Select
                value={doubleOptIn}
                onChange={(e) => setDoubleOptIn(e.target.value)}
                className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">Select an option</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </div>

            {/* OPT_IN */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Opt_in</label>
              <Select
                value={optIn}
                onChange={(e) => setOptIn(e.target.value)}
                className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">Select an option</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </div>

            {/* LISTS Selection */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Lists</label>
              <div className="border border-border rounded-xl p-4 max-h-48 overflow-y-auto space-y-2.5 bg-background">
                {lists.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No lists found</span>
                ) : (
                  lists.map((l: any) => (
                    <label key={l.id} className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer select-none">
                      <input 
                        type="checkbox"
                        checked={selectedListIds.includes(l.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedListIds([...selectedListIds, l.id])
                          } else {
                            setSelectedListIds(selectedListIds.filter(id => id !== l.id))
                          }
                        }}
                        className="w-4 h-4 rounded border-border text-accent focus:ring-accent accent-accent"
                      />
                      <span className="font-semibold text-foreground">{l.name}</span>
                      <span className="text-[9px] text-muted-foreground font-mono bg-muted/65 px-1.5 py-0.5 rounded ml-auto">ID: {l.id}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* Action Footer */}
          <div className="pt-6 border-t border-border flex justify-end gap-3">
            <button 
              onClick={() => setShowDrawer(false)}
              className="px-5 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            
            <button 
              disabled={createContactMutation.isPending || !emailAddress.trim()}
              onClick={() => {
                const attributes: Record<string, any> = {}
                if (firstName) attributes.FIRSTNAME = firstName
                if (lastName) attributes.LASTNAME = lastName
                if (company) attributes.COMPANY = company
                if (jobTitle) attributes.JOB_TITLE = jobTitle
                if (sms) attributes.SMS = `44${sms}`
                if (landline) attributes.LANDLINE_NUMBER = `44${landline}`
                if (extId) attributes.EXT_ID = extId
                if (doubleOptIn) attributes.DOUBLE_OPT_IN = doubleOptIn === 'yes'
                if (optIn) attributes.OPT_IN = optIn === 'yes'

                createContactMutation.mutate({
                  email: emailAddress.trim(),
                  attributes,
                  listIds: selectedListIds
                })
              }}
              className="px-6 py-2.5 bg-primary text-primary-foreground hover:bg-primary/85 active:scale-95 transition-all text-sm font-bold rounded-xl disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 cursor-pointer"
            >
              {createContactMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create
            </button>
          </div>

        </div>
      </div>
    )
  }

  if (selectedContactEmail) {
    return (
      <ContactDetails
        email={selectedContactEmail}
        onClose={() => setSelectedContactEmail(null)}
      />
    )
  }

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Contacts</h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button 
            onClick={() => setShowDrawer(true)}
            className="px-4 py-2 border border-border text-foreground hover:bg-muted/50 rounded-xl transition-all text-sm font-semibold cursor-pointer"
          >
            Create a contact
          </button>
          <ExportMenu
            filename={exportName}
            sheetName="Contacts"
            rows={exportRows}
            columns={contactExportColumnsWith(contactFields)}
          />
          <Link 
            to="/marketing/contacts/import"
            className="px-4 py-2 bg-foreground text-background font-semibold hover:opacity-90 active:scale-95 rounded-xl transition-all text-sm cursor-pointer block text-center"
          >
            Import contacts
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border mb-6">
        <div className="flex gap-6 -mb-px">
          <button className="pb-3 text-sm font-semibold border-b-2 border-accent text-accent">
            All contacts
          </button>
          <button className="pb-3 text-sm font-medium text-muted-foreground hover:text-foreground">
            +
          </button>
        </div>
      </div>

      {/* Filters / Actions Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 relative">
        <div className="flex flex-wrap items-center gap-3">
          {/* List selection filter dropdown */}
          <div className="relative">
            <button 
              onClick={() => setShowListDropdown(!showListDropdown)}
              className="flex items-center gap-2 px-3 py-2 border border-border rounded-xl text-sm font-medium hover:bg-muted/40 transition-colors bg-card text-foreground cursor-pointer"
            >
              <span>{selectedListName}</span>
              <ChevronDown className="w-4 h-4 opacity-75" />
            </button>
            {showListDropdown && (
              <div className="absolute left-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-lg z-20 max-h-72 overflow-y-auto py-1 animate-in fade-in duration-200">
                <button 
                  onClick={() => {
                    setSelectedListId(null)
                    setShowListDropdown(false)
                  }}
                  className={`w-full text-left px-4 py-2 hover:bg-muted/50 text-sm flex items-center justify-between font-semibold ${selectedListId === null ? 'text-accent bg-accent/5' : ''}`}
                >
                  All contacts
                </button>
                <div className="border-t border-border/60 my-1" />
                {lists.map((l: any) => (
                  <button 
                    key={l.id}
                    onClick={() => {
                      setSelectedListId(l.id)
                      setShowListDropdown(false)
                    }}
                    className={`w-full text-left px-4 py-2 hover:bg-muted/50 text-sm flex items-center justify-between ${selectedListId === l.id ? 'text-accent bg-accent/5 font-semibold' : ''}`}
                  >
                    <span className="truncate">{l.name}</span>
                    <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded font-mono">ID: {l.id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="flex items-center gap-2 px-3 py-2 border border-border rounded-xl text-sm font-medium hover:bg-muted/40 transition-colors bg-card text-muted-foreground cursor-pointer">
            <span>Add filter</span>
            <ChevronDown className="w-4 h-4 opacity-75" />
          </button>
          {selectedListId !== null && (
            <button 
              onClick={() => setSelectedListId(null)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent/10 hover:bg-accent/15 text-accent rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              <span>Filtered: {selectedListName}</span>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {selectedEmails.length > 0 && (
            <button
              onClick={() => setEnrolling(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-accent/10 hover:bg-accent/15 text-accent border border-accent/20 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              <Repeat className="w-3.5 h-3.5" />
              <span>Add to sequence ({selectedEmails.length})</span>
            </button>
          )}
          {enrolling && <EnrollDialog emails={selectedEmails} onClose={() => setEnrolling(false)} />}
          {selectedEmails.length > 0 && (
            <button 
              onClick={() => {
                if (confirm(`Are you sure you want to delete the ${selectedEmails.length} selected contact(s)?`)) {
                  deleteContactsMutation.mutate(selectedEmails)
                }
              }}
              disabled={deleteContactsMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 bg-destructive/10 hover:bg-destructive/15 text-destructive border border-destructive/20 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              {deleteContactsMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              <span>Delete selected ({selectedEmails.length})</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Search box */}
          <div className="relative flex-1 md:flex-none">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full md:w-64 pl-10 pr-4 py-2 border border-border rounded-xl text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <button className="p-2 border border-border rounded-xl hover:bg-muted/40 transition-colors bg-card text-muted-foreground">
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Contacts Count */}
      <div className="text-xs text-muted-foreground mb-4 font-medium">
        {isLoading ? 'Loading contacts...' : `${contacts.length} contacts`}
      </div>

      {/* Table Card */}
      <div className="bg-card border border-border overflow-hidden shadow-sm">
        {/* Mobile card list — the 7-column table below is unreadable under md */}
        <ul className="md:hidden divide-y divide-border">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="p-4 animate-pulse">
                <div className="h-6 bg-muted rounded w-full" />
              </li>
            ))
          ) : contacts.length === 0 ? (
            <li className="p-8 text-center text-muted-foreground text-sm">No contacts found.</li>
          ) : (
            paginatedContacts.map((contact: any) => {
              const firstName = contact.attributes?.FIRSTNAME || ''
              const lastName = contact.attributes?.LASTNAME || ''
              const fullName = `${firstName} ${lastName}`.trim() || contact.email

              return (
                <li
                  key={contact.email}
                  onClick={() => setSelectedContactEmail(contact.email)}
                  className="p-4 flex items-start gap-3 active:bg-muted/40 transition-colors cursor-pointer"
                >
                  <label
                    onClick={(e) => e.stopPropagation()}
                    className="touch-target flex items-center justify-center shrink-0 -m-2 p-2"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmails.includes(contact.email)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedEmails([...selectedEmails, contact.email])
                        } else {
                          setSelectedEmails(selectedEmails.filter(email => email !== contact.email))
                        }
                      }}
                      className="w-4 h-4 rounded border-border text-accent focus:ring-accent cursor-pointer accent-accent"
                    />
                  </label>
                  <Avatar name={fullName} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground truncate">{fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
                    {(contact.attributes?.JOB_TITLE || contact.attributes?.COMPANY) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {contact.attributes.JOB_TITLE}
                        {contact.attributes.JOB_TITLE && contact.attributes.COMPANY && ' at '}
                        <CompanyName name={contact.attributes.COMPANY} companyId={contact.companyId} />
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      <SubscriptionBadge status={contact.status} />
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {new Date(contact.createdAt).toLocaleDateString(undefined, {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric'
                        })}
                      </span>
                    </div>
                  </div>
                </li>
              )
            })
          )}
        </ul>

        <table className="hidden md:table w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-xs font-bold text-muted-foreground uppercase tracking-wider">
              <th className="px-6 py-4 w-12">
                <input 
                  type="checkbox" 
                  checked={isAllSelected}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate = isSomeSelected
                    }
                  }}
                  onChange={(e) => {
                    if (e.target.checked) {
                      const newSelected = [...selectedEmails]
                      paginatedContacts.forEach((c: any) => {
                        if (!newSelected.includes(c.email)) {
                          newSelected.push(c.email)
                        }
                      })
                      setSelectedEmails(newSelected)
                    } else {
                      const paginatedEmails = paginatedContacts.map((c: any) => c.email)
                      setSelectedEmails(selectedEmails.filter(email => !paginatedEmails.includes(email)))
                    }
                  }}
                  className="w-4 h-4 rounded border-border text-accent focus:ring-accent cursor-pointer accent-accent" 
                />
              </th>
              <th className="px-6 py-4">Contact</th>
              <th className="px-6 py-4">Subscribed</th>
              <th className="px-6 py-4">Blocklisted</th>
              <th className="px-6 py-4">Email</th>
              <th className="px-6 py-4">Landline</th>
              <th className="px-6 py-4">Creation Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-sm">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td colSpan={7} className="px-6 py-7">
                    <div className="h-6 bg-muted rounded w-full" />
                  </td>
                </tr>
              ))
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                  No contacts found.
                </td>
              </tr>
            ) : (
              paginatedContacts.map((contact: any) => {
                const firstName = contact.attributes?.FIRSTNAME || ''
                const lastName = contact.attributes?.LASTNAME || ''
                const fullName = `${firstName} ${lastName}`.trim() || contact.email

                return (
                  <tr 
                    key={contact.email} 
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedContactEmail(contact.email)}
                  >
                    <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                      <input 
                        type="checkbox" 
                        checked={selectedEmails.includes(contact.email)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedEmails([...selectedEmails, contact.email])
                          } else {
                            setSelectedEmails(selectedEmails.filter(email => email !== contact.email))
                          }
                        }}
                        className="w-4 h-4 rounded border-border text-accent focus:ring-accent cursor-pointer accent-accent" 
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={fullName} />
                        <div>
                          <p className="font-semibold text-foreground">{fullName}</p>
                          {(contact.attributes?.JOB_TITLE || contact.attributes?.COMPANY) && (
                            <p className="text-xs text-muted-foreground">
                              {contact.attributes.JOB_TITLE}
                              {contact.attributes.JOB_TITLE && contact.attributes.COMPANY && ' at '}
                              <CompanyName name={contact.attributes.COMPANY} companyId={contact.companyId} />
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <SubscriptionBadge status={contact.status} />
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">—</td>
                    <td className="px-6 py-4 font-medium text-foreground">{contact.email}</td>
                    <td className="px-6 py-4 text-muted-foreground">—</td>
                    <td className="px-6 py-4 text-xs text-muted-foreground font-medium">
                      {new Date(contact.createdAt).toLocaleDateString(undefined, {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                      })}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        totalItems={contacts.length}
        itemsPerPage={itemsPerPage}
        onItemsPerPageChange={setItemsPerPage}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
      />
    </div>
  )
}

/** The contact's company name, linking to its company page when it has one. */
function CompanyName({ name, companyId }: { name: string; companyId: string | null }) {
  if (!name || !companyId) return <>{name}</>
  return (
    <Link
      to="/marketing/companies/$id"
      params={{ id: companyId }}
      onClick={(e) => e.stopPropagation()}
      className="hover:text-accent hover:underline"
    >
      {name}
    </Link>
  )
}
