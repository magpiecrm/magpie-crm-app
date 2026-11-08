import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { useDeferredValue, useState, useMemo } from 'react'
import { 
  contactsFn, 
  listsFn, 
  listContactsFn,
  createContactFn,
  deleteContactsFn,
  getPersonasFn
} from '../../../server/functions'
import { 
  Search, 
  Loader2, 
  ChevronDown, 
  SlidersHorizontal,
  X,
  ArrowLeft,
  Trash2,
  Repeat,
  Columns3
} from 'lucide-react'
import { Pagination } from '../../../components/ui/Pagination'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { ContactDetails } from '../../../features/contacts/components/ContactDetails'
import { contactExportColumnsWith, type ExportableContact } from '../../../features/contacts/exportColumns'
import { ActiveFilters, AddFilterButton, newFilter } from '../../../features/contacts/components/ContactFilters'
import { applyFilters, contactSearchText, filterFields, isComplete, sortContacts, type ContactFilter, type ContactSort } from '../../../features/contacts/contactFilters'
import { ContactTable } from '../../../features/contacts/components/ContactTable'
import { AddColumnDialog, ColumnPicker } from '../../../features/contacts/components/ColumnPicker'
import { useContactColumns } from '../../../features/contacts/useContactColumns'
import { CustomFieldInput } from '../../../features/contacts/components/CustomFieldInput'
import type { ContactCustomValue } from '../../../features/contacts/contactFields'
import { Select } from '../../../components/ui/Select'
import { EnrollDialog } from '../../../features/sequences/components/EnrollDialog'

export const Route = createFileRoute('/marketing/contacts/')({
  // ?contact=<email> opens that contact (links from tasks and their reminders);
  // ?persona=<id> shows the people found with that persona (the Personas page).
  validateSearch: (search: Record<string, unknown>): { contact?: string; persona?: string } => ({
    ...(typeof search.contact === 'string' && search.contact ? { contact: search.contact } : {}),
    ...(typeof search.persona === 'string' && search.persona ? { persona: search.persona } : {}),
  }),
  component: ContactsPage,
})

function ContactsPage() {
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const { contact: linkedContact, persona: linkedPersona } = Route.useSearch()
  const [selectedContactEmail, setSelectedContactEmail] = useState<string | null>(linkedContact ?? null)
  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [showListDropdown, setShowListDropdown] = useState(false)
  const [filters, setFilters] = useState<ContactFilter[]>(() => (linkedPersona ? [{ id: 'persona:linked', field: 'persona', op: 'is', value: linkedPersona }] : []))
  const [showAddFilter, setShowAddFilter] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)
  const [selectedEmails, setSelectedEmails] = useState<string[]>([])
  const [sort, setSort] = useState<ContactSort | null>(null)
  const [choosingColumns, setChoosingColumns] = useState(false)
  const [addingColumn, setAddingColumn] = useState(false)

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
  const [customValues, setCustomValues] = useState<Record<string, ContactCustomValue>>({})

  const createContactMutation = useMutation({
    mutationFn: (data: { email: string; attributes: any; custom?: Record<string, unknown>; listIds?: number[] }) => 
      createContactFn({ data }),
    onSuccess: ({ fieldProblems }) => {
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
      setCustomValues({})
      alert(fieldProblems.length ? `Contact created, but some values weren't saved:\n${fieldProblems.join('\n')}` : 'Contact created successfully!')
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

  const { fields: contactFields, columns } = useContactColumns('contacts')
  const { data: personas = [] } = useQuery({ queryKey: queryKeys.prospects.personas(), queryFn: () => getPersonasFn() })

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

  // What can be filtered on: the built-in fields, with the values each has among these contacts, and the custom ones.
  const fields = useMemo(() => filterFields(contactFields, rawContacts, personas), [contactFields, rawContacts, personas])
  const activeFilters = useMemo(() => filters.filter((f) => isComplete(f, fields.find((x) => x.key === f.field))), [filters, fields])

  // Worked out once, on the first search, rather than on every letter typed.
  const deferredSearch = useDeferredValue(searchTerm)
  const searching = deferredSearch.trim() !== ''
  const searchTexts = useMemo(() => (searching ? new Map(rawContacts.map((c: any) => [c.email, contactSearchText(c)])) : null), [rawContacts, searching])

  // Client-side search, filtering and sorting
  const contacts = useMemo(() => {
    const filtered = applyFilters(rawContacts as any[], filters, fields)
    if (!searchTexts) return sortContacts(filtered, sort, contactFields)
    const term = deferredSearch.trim().toLowerCase()
    return sortContacts(filtered.filter((c: any) => searchTexts.get(c.email)?.includes(term)), sort, contactFields)
  }, [rawContacts, searchTexts, deferredSearch, filters, fields, sort, contactFields])

  // Reset page when search, list or filters change. The filters are compared
  // by what they say: the list itself is a new one on every render.
  const filterKey = JSON.stringify(activeFilters.map((f) => [f.field, f.op, f.value, f.values]))
  useMemo(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedListId, filterKey, sort])

  // Slice contacts for current page
  const paginatedContacts = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return contacts.slice(startIndex, startIndex + itemsPerPage)
  }, [contacts, currentPage, itemsPerPage])

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

            {contactFields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">{field.label}</span>
                <CustomFieldInput field={field} value={customValues[field.key]} onChange={(value) => setCustomValues((all) => ({ ...all, [field.key]: value }))} ariaLabel={field.label} />
              </div>
            ))}

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
                  custom: customValues,
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
          <AddFilterButton fields={fields} open={showAddFilter} onOpenChange={setShowAddFilter} onAdd={(field) => setFilters((all) => [...all, newFilter(field)])} />
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
          <button
            type="button"
            onClick={() => setChoosingColumns(true)}
            aria-label="Choose columns"
            title="Choose columns"
            className="p-2 border border-border rounded-xl hover:bg-muted/40 transition-colors bg-card cursor-pointer text-muted-foreground"
          >
            <Columns3 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowAddFilter(true)}
            aria-label="Add a filter"
            title="Add a filter"
            className={`relative p-2 border border-border rounded-xl hover:bg-muted/40 transition-colors bg-card cursor-pointer ${activeFilters.length ? 'text-accent' : 'text-muted-foreground'}`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            {activeFilters.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-bold flex items-center justify-center">{activeFilters.length}</span>
            )}
          </button>
        </div>
      </div>

      <ActiveFilters filters={filters} fields={fields} onChange={setFilters} />

      {/* Contacts Count */}
      <div className="text-xs text-muted-foreground mb-4 font-medium">
        {isLoading
          ? 'Loading contacts...'
          : activeFilters.length || searchTerm.trim()
            ? `${contacts.length.toLocaleString()} of ${rawContacts.length.toLocaleString()} contacts`
            : `${contacts.length.toLocaleString()} contacts`}
      </div>

      <ContactTable
        columns={columns}
        fields={contactFields}
        rows={paginatedContacts}
        isLoading={isLoading}
        empty="No contacts found."
        sort={sort}
        onSort={setSort}
        onRowClick={setSelectedContactEmail}
        selection={{ selected: selectedEmails, onChange: setSelectedEmails }}
        onAddColumn={() => setAddingColumn(true)}
      />
      {addingColumn && <AddColumnDialog view="contacts" onClose={() => setAddingColumn(false)} />}
      {choosingColumns && <ColumnPicker view="contacts" columns={columns} fields={contactFields} onClose={() => setChoosingColumns(false)} onAddColumn={() => setAddingColumn(true)} />}

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
