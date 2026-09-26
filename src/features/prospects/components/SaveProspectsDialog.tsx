import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { createListFn, listsFn, prospectingStatusFn, prospectJobFn, saveProspectsFn } from '../../../server/functions'
import type { PersonResult } from '../../../server/prospecting/types'
import { EmailStatusBadge } from './EmailStatusBadge'
import type { ProspectJob, SaveStatus } from '../../../server/prospecting/save'

const OUTCOME_LABEL: Record<SaveStatus, string> = {
  pending: 'Queued',
  saved: 'Saved',
  already_saved: 'Already a contact, added to list',
  suppressed: 'Opted out, not saved',
  no_domain: 'Company domain unknown',
  not_found: 'No email found',
  unconfirmed: "Couldn't verify an email",
  retrying: 'Server asked us to retry, waiting',
  limit: "Plan's email reveals used up",
  error: 'Failed',
}

interface Props {
  isOpen: boolean
  onClose: (saved: boolean) => void
  people: PersonResult[]
}

export function SaveProspectsDialog({ isOpen, onClose, people }: Props) {
  const queryClient = useQueryClient()
  const [listId, setListId] = useState<number | ''>('')
  const [newListName, setNewListName] = useState<string | null>(null)
  const [job, setJob] = useState<ProspectJob | null>(null)

  const { data: listsData } = useQuery({
    queryKey: queryKeys.email.lists(),
    queryFn: () => listsFn(),
    enabled: isOpen,
  })
  const lists: Array<{ id: number; name: string }> = listsData?.lists || []

  const { data: status } = useQuery({
    queryKey: queryKeys.prospects.status(),
    queryFn: () => prospectingStatusFn(),
    enabled: isOpen,
  })
  const verifiedOnly = status?.verification.verifiedOnly ?? true

  const createList = useMutation({
    mutationFn: (name: string) => createListFn({ data: { name } }),
    onSuccess: (list) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      setListId(list.id)
      setNewListName(null)
    },
  })

  const save = useMutation({
    mutationFn: (id: number) => saveProspectsFn({ data: { listId: id, people } }),
    onSuccess: setJob,
  })

  // Big saves (and small ones that outlive the sync timeout) come back still
  // running; poll until the job settles.
  const running = job?.status === 'running'
  const { data: polled } = useQuery({
    queryKey: queryKeys.prospects.job(job?.id ?? ''),
    queryFn: () => prospectJobFn({ data: { jobId: job!.id } }),
    enabled: running,
    refetchInterval: 1500,
  })
  const current = polled && polled.id === job?.id ? polled : job
  const finished = current !== null && current.status !== 'running'

  const finishedJobId = finished ? current.id : null
  useEffect(() => {
    if (!finishedJobId) return
    queryClient.invalidateQueries({ queryKey: queryKeys.email.contacts() })
    queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
  }, [finishedJobId, queryClient])

  const close = () => {
    const saved = Boolean(current?.outcomes.some((o) => o.status === 'saved' || o.status === 'already_saved'))
    setJob(null)
    setListId('')
    setNewListName(null)
    save.reset()
    onClose(saved)
  }

  const counts = current?.outcomes.reduce<Partial<Record<SaveStatus, number>>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title={current ? 'Finding emails' : `Save ${people.length} ${people.length === 1 ? 'person' : 'people'} to a list`}
      className="max-w-2xl"
    >
      <div className="p-6 space-y-4">
        {!current ? (
          <>
            {newListName !== null ? (
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">New list name</label>
                <div className="flex gap-2">
                  <input
                    autoFocus
                    type="text"
                    className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-md-s focus:ring-1 focus:ring-accent focus:border-transparent outline-none"
                    placeholder="e.g. Q1 Outreach"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newListName.trim()) {
                        e.preventDefault()
                        createList.mutate(newListName.trim())
                      }
                    }}
                  />
                  <Button disabled={!newListName.trim()} isLoading={createList.isPending} onClick={() => createList.mutate(newListName.trim())}>
                    Create
                  </Button>
                </div>
                {createList.isError && <p className="text-xs text-destructive mt-1.5">{(createList.error as Error).message}</p>}
                <button type="button" onClick={() => setNewListName(null)} className="text-[10px] text-accent hover:underline font-semibold mt-2">
                  Cancel
                </button>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">List</label>
                <select
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md-s focus:ring-1 focus:ring-accent focus:border-transparent outline-none"
                  value={listId}
                  onChange={(e) => setListId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Choose a list...</option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>{list.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setNewListName('')}
                  className="text-[10px] text-accent hover:underline font-semibold mt-2 inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  Create new list
                </button>
              </div>
            )}

            <p className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-md-s p-3 leading-relaxed">
              Saving looks up a work email for each person at their current company, for these people only.{' '}
              {verifiedOnly
                ? 'Only emails the mail server confirms are saved; anyone who can’t be verified is left out. '
                : 'Unconfirmed best guesses are saved too, with their status. '}
              Anyone who has opted out is skipped. New contacts are marked{' '}
              <span className="font-semibold">notice pending</span> until they've been told how their details were found.
              {people.length > 10 && ' This many people runs in the background, and you can watch progress here.'}
            </p>

            {save.isError && <p className="text-xs text-destructive font-medium">{(save.error as Error).message}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button disabled={!listId} isLoading={save.isPending} onClick={() => listId && save.mutate(listId)}>
                Find emails & save
              </Button>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="flex justify-between text-xs font-semibold text-foreground mb-1.5">
                <span>{finished ? (current.status === 'failed' ? 'Stopped with an error' : 'Done') : 'Working…'}</span>
                <span className="text-muted-foreground">{current.processed} / {current.total}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-accent h-1.5 rounded-full transition-[width] duration-500"
                  style={{ width: `${current.total ? (current.processed / current.total) * 100 : 0}%` }}
                />
              </div>
              {counts && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  {Object.entries(counts).map(([k, n]) => `${n} ${OUTCOME_LABEL[k as SaveStatus].toLowerCase()}`).join(' · ')}
                </p>
              )}
              {current.error && <p className="text-xs text-destructive mt-2">{current.error}</p>}
            </div>

            <div className="max-h-80 overflow-auto border border-border rounded-md-s divide-y divide-border">
              {current.outcomes.map((o) => (
                <div key={o.profileUrl} className="px-3 py-2 flex items-center gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground truncate">{o.name}</p>
                    <p className="text-muted-foreground truncate">{o.email ?? o.company}</p>
                    {o.message && !o.email && <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{o.message}</p>}
                  </div>
                  {o.emailStatus && <EmailStatusBadge status={o.emailStatus} />}
                  <span
                    className={`shrink-0 ${o.status === 'saved' || o.status === 'already_saved' ? 'text-foreground' : 'text-muted-foreground'}`}
                    title={o.message}
                  >
                    {OUTCOME_LABEL[o.status]}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={close}>{finished ? 'Close' : 'Close (keeps running)'}</Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
