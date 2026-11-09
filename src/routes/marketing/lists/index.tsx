import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { Users, Plus, List as ListIcon, Trash2, Filter } from 'lucide-react'
import { useState } from 'react'
import { listsFn, createListFn, deleteListFn } from '../../../server/functions'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { confirmDialog } from '../../../components/ui/confirm'
import { toast } from '../../../components/ui/toast'
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
    onSuccess: (_res, name) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      setShowModal(false)
      setNewListName('')
      toast.success('List created', { description: `“${name}” is ready for contacts.` })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteListFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      toast.success('List deleted')
    },
    onError: (err: any) => {
      toast.error("Couldn't delete the list", { description: err.message })
    }
  })

  const closeModal = () => {
    setShowModal(false)
    setNewListName('')
    createMutation.reset()
  }

  const lists = listsData?.lists || []

  return (
    <div className="p-4 lg:p-8">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-2">Contact Lists</h1>
          <p className="text-muted-foreground">Manage your synced contact lists locally.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ExportMenu
            filename="lists"
            sheetName="Lists"
            rows={lists as ListRow[]}
            columns={listExportColumns}
          />
          <Link
            to="/marketing/lists/new"
            className="border border-border bg-card text-foreground px-4 py-2.5 rounded-md-s font-medium hover:bg-muted transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Filter className="w-4 h-4" />
            Build from contacts
          </Link>
          <button 
            onClick={() => setShowModal(true)}
            className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md-s font-medium hover:bg-primary/85 active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New list
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
                    onClick={async (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const ok = await confirmDialog({
                        title: `Delete “${list.name}”?`,
                        message: 'The list goes, but the contacts on it stay in Contacts.',
                        confirmLabel: 'Delete list',
                        tone: 'danger',
                      })
                      if (ok) deleteMutation.mutate(list.id)
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
                {list.builtFrom && <span className="text-xs">· from filters</span>}
              </div>
            </Link>
          ))
        )}
      </div>

      <Dialog isOpen={showModal} onClose={closeModal} title="New list" description="Add contacts to it by hand or from an import." className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            if (newListName.trim() && !createMutation.isPending) createMutation.mutate(newListName.trim())
          }}
        >
          <DialogBody>
            <Field label="Name" error={createMutation.error?.message}>
              <input
                type="text"
                required
                maxLength={200}
                placeholder="e.g. Newsletter subscribers"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                className={INPUT_CLASS}
                autoFocus
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Create list
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  )
}


