import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { listContactsFn, listsFn, deleteListFn, removeContactFromListFn, getContactFieldsFn } from '../../../server/functions'
import { Loader2, Mail, Building, Briefcase, ArrowLeft, Trash2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Avatar } from '../../../components/ui/Avatar'
import { useState } from 'react'
import { Pagination } from '../../../components/ui/Pagination'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { contactExportColumnsWith } from '../../../features/contacts/exportColumns'

export const Route = createFileRoute('/marketing/lists/$listId')({
  component: ListDetailsPage,
})

function ListDetailsPage() {
  const { listId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)

  const { data: contactsData, isLoading: isLoadingContacts } = useQuery({
    queryKey: queryKeys.email.listContacts(listId),
    queryFn: () => listContactsFn({ data: { listId: parseInt(listId) } }),
  })

  const { data: listsData } = useQuery({
    queryKey: queryKeys.email.lists(),
    queryFn: () => listsFn(),
  })

  const { data: contactFields = [] } = useQuery({
    queryKey: queryKeys.email.contactFields(),
    queryFn: () => getContactFieldsFn(),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteListFn({ data: { id: parseInt(listId) } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      navigate({ to: '/marketing/lists' })
    },
    onError: (err: any) => {
      alert(`Failed to delete list: ${err.message}`)
    }
  })

  const removeContactMutation = useMutation({
    mutationFn: (email: string) => removeContactFromListFn({ data: { listId: parseInt(listId), email } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.listContacts(listId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
    },
    onError: (err: any) => {
      alert(`Failed to remove contact: ${err.message}`)
    }
  })

  const currentList = listsData?.lists?.find((l: any) => l.id === parseInt(listId))
  const contacts = contactsData?.contacts || []

  // Slice contacts for current page
  const paginatedContacts = contacts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-8">
        <Link 
          to="/marketing/lists" 
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors mb-4 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to lists
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display text-foreground mb-2">
              {currentList ? currentList.name : 'List Contacts'}
            </h1>
            <p className="text-muted-foreground">
              Viewing {contacts.length} contacts in this list.
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <ExportMenu
              filename={currentList ? `list_${currentList.name}` : `list_${listId}`}
              sheetName={currentList?.name ?? 'Contacts'}
              rows={contacts}
              columns={contactExportColumnsWith(contactFields)}
            />
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirm(`Delete list "${currentList?.name || 'this list'}"? This won't delete the contacts themselves, just this list.`)) {
                  deleteMutation.mutate()
                }
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground rounded-md-s hover:bg-destructive/10 hover:text-destructive transition-colors border border-transparent hover:border-destructive/20 cursor-pointer font-semibold disabled:opacity-50"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete List
            </button>
          </div>
        </div>
      </div>

      <div className="card border border-border overflow-hidden bg-card shadow-sm">
        {/* Mobile card list */}
        <ul className="md:hidden divide-y divide-border">
          {isLoadingContacts ? (
            Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="p-4 animate-pulse">
                <div className="h-10 bg-muted rounded w-full" />
              </li>
            ))
          ) : contacts.length === 0 ? (
            <li className="p-8 text-center text-muted-foreground text-sm">No contacts found in this list.</li>
          ) : (
            paginatedContacts.map((contact: any) => {
              const name = `${contact.attributes?.FIRSTNAME || ''} ${contact.attributes?.LASTNAME || ''}`.trim()
              return (
                <li key={contact.email} className="p-4 flex items-start gap-3">
                  <Avatar name={name || contact.email} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground truncate">{name || contact.email}</p>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                      <Mail className="w-3 h-3 shrink-0" />
                      {contact.email}
                    </p>
                    {contact.attributes?.COMPANY && (
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                        <Building className="w-3 h-3 shrink-0" />
                        {contact.attributes.COMPANY}
                      </p>
                    )}
                    {contact.attributes?.JOB_TITLE && (
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                        <Briefcase className="w-3 h-3 shrink-0" />
                        {contact.attributes.JOB_TITLE}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Added {new Date(contact.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={removeContactMutation.isPending}
                    onClick={() => {
                      if (confirm(`Remove ${contact.email} from this list?`)) {
                        removeContactMutation.mutate(contact.email)
                      }
                    }}
                    className="touch-target shrink-0 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors rounded cursor-pointer disabled:opacity-50"
                    aria-label={`Remove ${contact.email} from list`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              )
            })
          )}
        </ul>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Company</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Title</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Added to List</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoadingContacts ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-4 sm:px-6 py-8">
                      <div className="h-10 bg-muted rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    No contacts found in this list.
                  </td>
                </tr>
              ) : (
                paginatedContacts.map((contact: any) => (
                  <tr key={contact.email} className="hover:bg-muted/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={`${contact.attributes?.FIRSTNAME || ''} ${contact.attributes?.LASTNAME || ''}` || contact.email} />
                        <p className="font-semibold text-foreground whitespace-nowrap">
                          {contact.attributes?.FIRSTNAME || contact.attributes?.LASTNAME
                            ? `${contact.attributes?.FIRSTNAME || ''} ${contact.attributes?.LASTNAME || ''}`.trim()
                            : <span className="text-muted-foreground font-normal">—</span>}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-foreground flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        {contact.email}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      {contact.attributes?.COMPANY ? (
                        <p className="text-sm text-foreground flex items-center gap-1.5">
                          <Building className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          {contact.attributes.COMPANY}
                        </p>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {contact.attributes?.JOB_TITLE ? (
                        <p className="text-sm text-foreground flex items-center gap-1.5">
                          <Briefcase className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          {contact.attributes.JOB_TITLE}
                        </p>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(contact.createdAt).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        disabled={removeContactMutation.isPending}
                        onClick={() => {
                          if (confirm(`Remove ${contact.email} from this list?`)) {
                            removeContactMutation.mutate(contact.email)
                          }
                        }}
                        className="text-muted-foreground opacity-0 group-hover:opacity-100 touch-reveal hover:text-destructive transition-all p-1.5 rounded cursor-pointer disabled:opacity-50"
                        aria-label={`Remove ${contact.email} from list`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 pb-2">
          <Pagination
            totalItems={contacts.length}
            itemsPerPage={itemsPerPage}
            onItemsPerPageChange={setItemsPerPage}
            currentPage={currentPage}
            onPageChange={(page) => {
              setCurrentPage(page)
            }}
          />
        </div>
      </div>
    </div>
  )
}
