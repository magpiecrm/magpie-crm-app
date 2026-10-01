import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { enrollInSequenceFn, listsFn, sequencesFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { Select } from '../../../components/ui/Select'
import { queryKeys } from '../../../queryKeys'
import { FIELD_CLASS } from '../../sales/forms'
import { SKIP_REASONS } from './labels'

/**
 * Adds people to a sequence: a list's contacts (from the sequence's page),
 * or chosen contacts (from Contacts, choosing the sequence). Shows how many
 * would be added, and why any are left out, before adding them.
 */
export function EnrollDialog({ sequenceId, emails, onClose }: { sequenceId?: string; emails?: string[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: lists = [] } = useQuery({ queryKey: queryKeys.email.lists(), queryFn: () => listsFn(), enabled: !emails, select: (r) => r.lists })
  const { data: all = [] } = useQuery({ queryKey: queryKeys.sequences.list(), queryFn: () => sequencesFn(), enabled: !sequenceId })
  const [listId, setListId] = useState('')
  const [chosenSequence, setChosenSequence] = useState('')
  const target = sequenceId ?? chosenSequence
  const source = emails ? { emails } : listId ? { listId: Number(listId) } : null

  const check = useMutation({ mutationFn: () => enrollInSequenceFn({ data: { id: target, ...source!, dryRun: true } }) })
  useEffect(() => {
    if (target && source) check.mutate()
    else check.reset()
  }, [target, listId])

  const [done, setDone] = useState<number | null>(null)
  const enroll = useMutation({
    mutationFn: () => enrollInSequenceFn({ data: { id: target, ...source! } }),
    onSuccess: (r) => {
      setDone(r.enrolled)
      void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.list() })
      if (target) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.sequence(target) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.enrollments(target) })
      }
    },
  })
  const skipped = Object.entries(check.data?.skipped ?? {})
  const sequenceName = all.find((s) => s.id === target)?.name

  return (
    <Dialog isOpen onClose={onClose} title="Add people to a sequence">
      {done !== null ? (
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            Added {done.toLocaleString('en-GB')} {done === 1 ? 'person' : 'people'}
            {sequenceName ? ` to "${sequenceName}"` : ''}. Their first email goes out in the sequence's sending hours, once it's running.
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (check.data?.enrolled) enroll.mutate()
          }}
          className="space-y-4"
        >
          {!sequenceId && (
            <div>
              <label htmlFor="enroll-seq" className="block text-sm font-medium text-foreground mb-1">
                Sequence
              </label>
              {all.length ? (
                <Select id="enroll-seq" value={chosenSequence} onChange={(e) => setChosenSequence(e.target.value)} className={FIELD_CLASS}>
                  <option value="">Choose a sequence…</option>
                  {all.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">Make a sequence first (Sell → Sequences).</p>
              )}
            </div>
          )}
          {emails ? (
            <p className="text-sm text-muted-foreground">
              {emails.length.toLocaleString('en-GB')} chosen {emails.length === 1 ? 'contact' : 'contacts'}.
            </p>
          ) : (
            <div>
              <label htmlFor="enroll-list" className="block text-sm font-medium text-foreground mb-1">
                From the list
              </label>
              <Select id="enroll-list" value={listId} onChange={(e) => setListId(e.target.value)} className={FIELD_CLASS}>
                <option value="">Choose a list…</option>
                {lists.map((l: any) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {check.isPending && <p className="text-sm text-muted-foreground">Checking…</p>}
          {check.error && <p className="text-sm text-destructive">{(check.error as Error).message}</p>}
          {check.data && (
            <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-1">
              <p className="text-foreground font-medium">
                {check.data.enrolled.toLocaleString('en-GB')} {check.data.enrolled === 1 ? 'person' : 'people'} will be added.
              </p>
              {skipped.map(([why, n]) => (
                <p key={why} className="text-muted-foreground">
                  {n.toLocaleString('en-GB')} left out: they {SKIP_REASONS[why] ?? why}.
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <span className="flex-1 text-xs text-destructive">{(enroll.error as Error | null)?.message}</span>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" isLoading={enroll.isPending} disabled={!check.data?.enrolled}>
              Add {check.data?.enrolled ? check.data.enrolled.toLocaleString('en-GB') : ''}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
