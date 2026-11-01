import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { addNewMatchesFn, listFilterFieldsFn } from '../../../server/functions'
import { describeFilter, filterProblems, type SavedFilter } from '../contactFilters'
import { WhoCanBeEmailed } from './ListPreviewCounts'

const count = (n: number) => n.toLocaleString('en-GB')

/** Shows who would be added before adding them. Nobody comes off. */
function AddMatchesDialog({ listId, onClose }: { listId: number; onClose: () => void }) {
  const queryClient = useQueryClient()
  const check = useMutation({ mutationFn: () => addNewMatchesFn({ data: { listId, dryRun: true } }) })
  useEffect(() => check.mutate(), [listId])

  const add = useMutation({
    mutationFn: () => addNewMatchesFn({ data: { listId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.listContacts(String(listId)) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.contactsByList(listId) })
    },
  })
  const preview = check.data

  return (
    <Dialog isOpen onClose={onClose} title="Add new matches" padded>
      {add.isSuccess ? (
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            Added {count(add.data.toAdd)} {add.data.toAdd === 1 ? 'person' : 'people'} to this list.
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {check.isError ? (
            <Notice level="error">{check.error.message}</Notice>
          ) : !preview ? (
            <p className="text-sm text-muted-foreground">Checking who matches now…</p>
          ) : preview.toAdd === 0 ? (
            <p className="text-sm text-foreground">Nobody new matches these filters.</p>
          ) : (
            <>
              <p className="text-sm text-foreground">
                {count(preview.toAdd)} new {preview.toAdd === 1 ? 'match' : 'matches'} to add.
              </p>
              <WhoCanBeEmailed preview={preview} />
            </>
          )}
          {preview && (
            <p className="text-xs text-muted-foreground">
              {count(preview.alreadyOn)} already on the list.
              {preview.removedByHand > 0 && ` ${count(preview.removedByHand)} taken off by hand ${preview.removedByHand === 1 ? 'stays' : 'stay'} off.`} Nobody is removed.
            </p>
          )}
          {add.isError && <Notice level="error">{add.error.message}</Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button isLoading={add.isPending} disabled={!preview?.toAdd} onClick={() => add.mutate()}>
              {preview?.toAdd ? `Add ${count(preview.toAdd)}` : 'Add'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

/** On a list built from filters: what they were, and a way to add who matches now. */
export function BuiltFromPanel({ listId, builtFrom }: { listId: number; builtFrom: { filters: SavedFilter[]; refreshedAt: string | null; removedCount: number } }) {
  const [adding, setAdding] = useState(false)
  const { data: fields } = useQuery({ queryKey: queryKeys.email.listFilterFields(), queryFn: () => listFilterFieldsFn() })
  const problem = fields ? filterProblems(builtFrom.filters, fields)[0] : undefined

  return (
    <div className="card border border-border p-4 mb-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground mb-1">Built from these filters</p>
          <ul className="text-sm text-foreground space-y-0.5">
            {builtFrom.filters.map((f) => (
              <li key={f.id}>{describeFilter(f, fields?.find((x) => x.key === f.field))}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-2">
            New contacts aren't added by themselves.
            {builtFrom.refreshedAt && ` Last updated ${new Date(builtFrom.refreshedAt).toLocaleDateString('en-GB')}.`}
            {builtFrom.removedCount > 0 && ` ${count(builtFrom.removedCount)} taken off by hand ${builtFrom.removedCount === 1 ? 'stays' : 'stay'} off.`}
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={!fields || Boolean(problem)} onClick={() => setAdding(true)}>
          Add new matches
        </Button>
      </div>
      {problem && <Notice level="warning">{problem} These filters can't be run again. Build a new list to use different ones.</Notice>}
      {adding && <AddMatchesDialog listId={listId} onClose={() => setAdding(false)} />}
    </div>
  )
}
