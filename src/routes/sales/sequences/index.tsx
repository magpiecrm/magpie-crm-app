import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus, Repeat } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { createSequenceFn, getSendersFn, sequencesFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Dialog } from '../../../components/ui/Dialog'
import { Select } from '../../../components/ui/Select'
import { FIELD_CLASS } from '../../../features/sales/forms'
import { percent, SEQUENCE_STATUS } from '../../../features/sequences/components/labels'

export const Route = createFileRoute('/sales/sequences/')({
  component: SequencesPage,
})

function SequencesPage() {
  const { data = [], isLoading, error } = useQuery({ queryKey: queryKeys.sequences.list(), queryFn: () => sequencesFn() })
  const [creating, setCreating] = useState(false)

  return (
    <div className="p-4 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-1">Sequences</h1>
          <p className="text-sm text-muted-foreground">A few personal emails to each person, days apart, that stop when they reply.</p>
        </div>
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
          New sequence
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Repeat className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">No sequences yet</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-md mx-auto">
            Write a first email and a couple of follow-ups, add people from a list, and it sends them through the working day, as replies in the same
            thread, until each person replies.
          </p>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
            New sequence
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Sequence</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Emails</th>
                <th className="px-4 py-3 text-right">People</th>
                <th className="px-4 py-3 text-right">In progress</th>
                <th className="px-4 py-3 text-right">Sent</th>
                <th className="px-4 py-3 text-right">Replied</th>
                <th className="px-4 py-3 text-right">Bounced</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link to="/sales/sequences/$id" params={{ id: s.id }} className="font-medium text-foreground hover:text-accent">
                      {s.name}
                    </Link>
                    <p className="text-xs text-muted-foreground truncate max-w-xs">{s.sender ?? 'No sender chosen'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={SEQUENCE_STATUS[s.status].variant}>{SEQUENCE_STATUS[s.status].label}</Badge>
                    {s.paused_reason && <p className="text-xs text-muted-foreground mt-1 max-w-xs">{s.paused_reason}</p>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.steps}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.enrolled}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.active}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.sent}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {s.replied} <span className="text-muted-foreground">{percent(s.replied, s.enrolled)}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.bounced}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewSequenceDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function NewSequenceDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const { data: senders = [] } = useQuery({ queryKey: queryKeys.email.senders(), queryFn: () => getSendersFn(), select: (r) => r.senders })
  const [senderId, setSenderId] = useState<string>('')
  const chosen = senderId || (senders[0] ? String(senders[0].id) : '')
  const create = useMutation({
    mutationFn: () =>
      createSequenceFn({
        data: { name, senderId: chosen ? Number(chosen) : null, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      }),
    onSuccess: (s) => navigate({ to: '/sales/sequences/$id', params: { id: s.id } }),
  })
  return (
    <Dialog isOpen onClose={onClose} title="New sequence">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="seq-name" className="block text-sm font-medium text-foreground mb-1">
            Name
          </label>
          <input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. UK agency founders" className={FIELD_CLASS} autoFocus />
          <p className="mt-1 text-xs text-muted-foreground">Only you see this.</p>
        </div>
        <div>
          <label htmlFor="seq-sender" className="block text-sm font-medium text-foreground mb-1">
            Sends from
          </label>
          {senders.length ? (
            <Select id="seq-sender" value={chosen} onChange={(e) => setSenderId(e.target.value)} className={FIELD_CLASS}>
              {senders.map((s: any) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name ? `${s.name} <${s.email}>` : s.email}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">Add a sender in Settings → Sending first.</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          <span className="flex-1 text-xs text-destructive">{(create.error as Error | null)?.message}</span>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={create.isPending} disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
