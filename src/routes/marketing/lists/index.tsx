import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { Users, Plus, List as ListIcon, Loader2, X, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { listsFn, createListFn, deleteListFn } from '../../../server/functions'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import type { ExportColumn } from '../../../utils/export'

interface ListRow {
  id: number
  name: string
  createdAt?: string
  totalContacts?: number
}

const listExportColumns: ExportColumn<ListRow>[] = [
  { header: 'List ID', value: l => l.id },
  { header: 'Name', value: l => l.name },
  { header: 'Contacts', value: l => l.totalContacts ?? 0 },
  { header: 'Created At', value: l => l.createdAt ?? '' },
]

export const Route = createFileRoute('/marketing/lists/')({
  component: ListsPage,
})

function ListsPage() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [newListName, setNewListName] = useState('')

  const { data: listsData, isLoading } = useQuery({
    queryKey: queryKeys.email.lists(),
    queryFn: () => listsFn(),
  })

  const createMutation = useMutation({
    mutationFn: (name: string) => createListFn({ data: { name } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      setShowModal(false)
      setNewListName('')
      alert('List created successfully!')
    },
    onError: (err: any) => {
      alert(`Failed to create list: ${err.message}`)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteListFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
    },
    onError: (err: any) => {
      alert(`Failed to delete list: ${err.message}`)
    }
  })

  const lists = listsData?.lists || []

  return (
    <div className="p-4 lg:p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-2">Contact Lists</h1>
          <p className="text-muted-foreground">Manage your synced contact lists locally.</p>
        </div>
        <div className="flex items-center gap-3">
          <ExportMenu
            filename="lists"
            sheetName="Lists"
            rows={lists as ListRow[]}
            columns={listExportColumns}
          />
          <button 
            onClick={() => setShowModal(true)}
            className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md-s font-medium hover:bg-primary/85 active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create New List
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-32 border border-border" />
          ))
        ) : lists.length === 0 ? (
          <div className="col-span-full py-12 text-center text-muted-foreground card border border-border">
            No lists found.
          </div>
        ) : (
          lists.map((list: any) => (
            <Link
              key={list.id}
              to="/marketing/lists/$listId"
              params={{ listId: list.id.toString() }}
              className="card p-6 border border-border hover:border-accent/40 transition-all group md-state-hover cursor-pointer block relative"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-accent/10 text-accent rounded-md-s">
                  <ListIcon className="w-5 h-5" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground opacity-50 group-hover:text-accent group-hover:opacity-100 transition-all">ID: {list.id}</span>
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (confirm(`Delete list "${list.name}"? This won't delete the contacts themselves, just this list.`)) {
                        deleteMutation.mutate(list.id)
                      }
                    }}
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-all p-1 -m-1 rounded cursor-pointer disabled:opacity-50"
                    aria-label={`Delete list ${list.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <h3 className="font-display text-foreground mb-1 truncate">{list.name}</h3>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4" />
                {list.totalContacts} contacts
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Create List Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl animate-in zoom-in-95 duration-200 relative">
            <button 
              onClick={() => {
                setShowModal(false)
                setNewListName('')
              }}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground p-1 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            <h2 className="text-xl font-bold mb-1 text-foreground">Create Contact List</h2>
            <p className="text-xs text-muted-foreground mb-6">Enter a descriptive name for your new marketing list.</p>
            
            <input
              type="text"
              placeholder="e.g. Newsletter Subscribers"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-border bg-background text-foreground mb-6 focus:outline-none focus:ring-2 focus:ring-accent"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newListName.trim() && !createMutation.isPending) {
                  createMutation.mutate(newListName.trim())
                }
              }}
            />
            
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowModal(false)
                  setNewListName('')
                }}
                className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted/50 transition-colors text-sm font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={createMutation.isPending || !newListName.trim()}
                onClick={() => createMutation.mutate(newListName.trim())}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/85 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create List
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


