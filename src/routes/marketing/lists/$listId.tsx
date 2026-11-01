import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { listContactsFn, listsFn, deleteListFn, removeContactFromListFn } from '../../../server/functions'
import { Loader2, ArrowLeft, Trash2, Columns3 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Pagination } from '../../../components/ui/Pagination'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { BuiltFromPanel } from '../../../features/contacts/components/BuiltFromPanel'
import { contactExportColumnsWith } from '../../../features/contacts/exportColumns'
import { ContactTable } from '../../../features/contacts/components/ContactTable'
import { AddColumnDialog, ColumnPicker } from '../../../features/contacts/components/ColumnPicker'
import { sortContacts, type ContactSort } from '../../../features/contacts/contactFilters'
import { useContactColumns } from '../../../features/contacts/useContactColumns'

export const Route = createFileRoute('/marketing/lists/$listId')({
  component: ListDetailsPage,
})

function ListDetailsPage() {
  const { listId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)
  const [sort, setSort] = useState<ContactSort | null>(null)
  const [choosingColumns, setChoosingColumns] = useState(false)
  const [addingColumn, setAddingColumn] = useState(false)

  const { data: contactsData, isLoading: isLoadingContacts } = useQuery({
    queryKey: queryKeys.email.listContacts(listId),
    queryFn: () => listContactsFn({ data: { listId: parseInt(listId) } }),
  })

  const { data: listsData } = useQuery({
    queryKey: queryKeys.email.lists(),
    queryFn: () => listsFn(),
  })

  const { fields: contactFields, columns } = useContactColumns('list')

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
  const contacts = useMemo(() => sortContacts(contactsData?.contacts || [], sort, contactFields), [contactsData, sort, contactFields])

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
            <button
              type="button"
              onClick={() => setChoosingColumns(true)}
              aria-label="Choose columns"
              title="Choose columns"
              className="p-2 text-muted-foreground rounded-md-s hover:bg-muted/40 transition-colors cursor-pointer"
            >
              <Columns3 className="w-4 h-4" />
            </button>
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

      {addingColumn && <AddColumnDialog view="list" onClose={() => setAddingColumn(false)} />}
      {choosingColumns && <ColumnPicker view="list" columns={columns} fields={contactFields} onClose={() => setChoosingColumns(false)} onAddColumn={() => setAddingColumn(true)} />}

      {currentList?.builtFrom && <BuiltFromPanel listId={parseInt(listId)} builtFrom={currentList.builtFrom} />}

      <div className="card border border-border overflow-hidden bg-card shadow-sm">
        <ContactTable
          columns={columns}
          fields={contactFields}
          rows={paginatedContacts}
          isLoading={isLoadingContacts}
          empty="No contacts found in this list."
          sort={sort}
          onSort={setSort}
          onAddColumn={() => setAddingColumn(true)}
          rowActions={(contact) => (
            <button
              type="button"
              disabled={removeContactMutation.isPending}
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Remove ${contact.email} from this list?`)) {
                  removeContactMutation.mutate(contact.email)
                }
              }}
              className="touch-target md:opacity-0 md:group-hover:opacity-100 touch-reveal text-muted-foreground hover:text-destructive transition-all p-1.5 rounded cursor-pointer disabled:opacity-50"
              aria-label={`Remove ${contact.email} from list`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        />
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
