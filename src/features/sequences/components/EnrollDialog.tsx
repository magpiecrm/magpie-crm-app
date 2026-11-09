import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { enrollInSequenceFn, listsFn, sequencesFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Field } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
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
    <Dialog isOpen onClose={onClose} title="Add people to a sequence" className="sm:max-w-md">
      {done !== null ? (
        <>
          <DialogBody>
            <Notice level="success" title={`Added ${done.toLocaleString('en-GB')} ${done === 1 ? 'person' : 'people'}${sequenceName ? ` to “${sequenceName}”` : ''}`}>
              Their first email goes out in the sequence's sending hours, once it's running.
            </Notice>
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (check.data?.enrolled) enroll.mutate()
          }}
          className="flex min-h-0 flex-col"
        >
          <DialogBody className="space-y-4">
            {!sequenceId &&
              (all.length ? (
                <Field label="Sequence">
                  <Select id="enroll-seq" value={chosenSequence} onChange={(e) => setChosenSequence(e.target.value)} className={FIELD_CLASS}>
                    <option value="">Choose a sequence…</option>
                    {all.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Notice>Make a sequence first (Sell → Sequences).</Notice>
              ))}
            {emails ? (
              <p className="text-sm text-muted-foreground">
                {emails.length.toLocaleString('en-GB')} chosen {emails.length === 1 ? 'contact' : 'contacts'}.
              </p>
            ) : (
              <Field label="From the list">
                <Select id="enroll-list" value={listId} onChange={(e) => setListId(e.target.value)} className={FIELD_CLASS}>
                  <option value="">Choose a list…</option>
                  {lists.map((l: any) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {check.isPending && <p className="text-sm text-muted-foreground">Checking who can be added…</p>}
            {check.error && <Notice level="error">{(check.error as Error).message}</Notice>}
            {check.data && (
              <div className="rounded-md-s border border-border bg-muted/40 px-3 py-2.5 text-sm space-y-1">
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
          </DialogBody>
          <DialogFooter>
            {enroll.error && <p className="text-[13px] text-destructive sm:mr-auto">{(enroll.error as Error).message}</p>}
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" isLoading={enroll.isPending} disabled={!check.data?.enrolled}>
              {check.data?.enrolled ? `Add ${check.data.enrolled.toLocaleString('en-GB')} ${check.data.enrolled === 1 ? 'person' : 'people'}` : 'Add people'}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  )
}
