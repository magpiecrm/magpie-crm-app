import { Fragment, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, UserPlus } from 'lucide-react'
import { enrollmentActionFn, sequenceEnrollmentsFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Select } from '../../../components/ui/Select'
import { queryKeys } from '../../../queryKeys'
import { EnrollDialog } from './EnrollDialog'
import { FirstEmailBadge, PersonalDraftPanel } from './Personalise'
import { ENROLLMENT_STATUS, when } from './labels'
import { isPersonalised, type EnrollmentStatus, type Sequence } from '../types'

type Action = 'pause' | 'resume' | 'mark_replied' | 'stop' | 'remove'
const ACTIONS: Array<{ id: Action; label: string }> = [
  { id: 'mark_replied', label: 'Mark as replied' },
  { id: 'pause', label: 'Pause' },
  { id: 'resume', label: 'Resume' },
  { id: 'stop', label: 'Stop' },
  { id: 'remove', label: 'Remove (if nothing sent yet)' },
]

/** Who's in the sequence, where each person is, and what's next for them. */
export function PeopleTable({ sequence }: { sequence: Sequence }) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<EnrollmentStatus | ''>('')
  const [picked, setPicked] = useState<string[]>([])
  // Whose own first email is open.
  const [open, setOpen] = useState<string | null>(null)
  const personal = isPersonalised(sequence)
  const { data = [], isLoading } = useQuery({
    queryKey: queryKeys.sequences.enrollments(sequence.id),
    queryFn: () => sequenceEnrollmentsFn({ data: { id: sequence.id } }),
    refetchInterval: 60_000,
  })
  const rows = useMemo(() => (filter ? data.filter((e) => e.status === filter) : data), [data, filter])
  const counts = useMemo(() => data.reduce<Record<string, number>>((m, e) => ((m[e.status] = (m[e.status] ?? 0) + 1), m), {}), [data])

  const act = useMutation({
    mutationFn: (action: Action) => enrollmentActionFn({ data: { ids: picked, action } }),
    onSuccess: () => {
      setPicked([])
      void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.enrollments(sequence.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.sequence(sequence.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.list() })
    },
  })
  const allPicked = rows.length > 0 && rows.every((r) => picked.includes(r.id))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as EnrollmentStatus | '')} className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground w-48">
          <option value="">Everyone ({data.length})</option>
          {(Object.keys(ENROLLMENT_STATUS) as EnrollmentStatus[])
            .filter((s) => counts[s])
            .map((s) => (
              <option key={s} value={s}>
                {ENROLLMENT_STATUS[s].label} ({counts[s]})
              </option>
            ))}
        </Select>
        {picked.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-sm text-muted-foreground mr-1">{picked.length} chosen:</span>
            {ACTIONS.map((a) => (
              <Button key={a.id} size="sm" variant="ghost" isLoading={act.isPending && act.variables === a.id} onClick={() => act.mutate(a.id)}>
                {a.label}
              </Button>
            ))}
          </div>
        )}
        <span className="flex-1" />
        <Button leftIcon={<UserPlus className="w-4 h-4" />} onClick={() => setAdding(true)} disabled={sequence.status === 'archived'}>
          Add people
        </Button>
      </div>
      {act.error && <p className="text-sm text-destructive">{(act.error as Error).message}</p>}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nobody yet. Add people from a list here, or choose contacts on the Contacts page and add them to this sequence.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" aria-label="Choose everyone shown" checked={allPicked} onChange={() => setPicked(allPicked ? [] : rows.map((r) => r.id))} className="accent-accent" />
                </th>
                <th className="px-4 py-3">Person</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Emails sent</th>
                <th className="px-4 py-3">Next email</th>
                {personal && <th className="px-4 py-3">First email</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <Fragment key={e.id}>
                <tr className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Choose ${e.name ?? e.contact_email}`}
                      checked={picked.includes(e.id)}
                      onChange={() => setPicked((p) => (p.includes(e.id) ? p.filter((x) => x !== e.id) : [...p, e.id]))}
                      className="accent-accent"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link to="/marketing/contacts" search={{ contact: e.contact_email }} className="font-medium text-foreground hover:text-accent">
                      {e.name ?? e.contact_email}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {e.name ? e.contact_email : ''}
                      {e.company ? `${e.name ? ' · ' : ''}${e.company}` : ''}
                      {e.guessed ? ' · unconfirmed address' : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ENROLLMENT_STATUS[e.status].variant}>{ENROLLMENT_STATUS[e.status].label}</Badge>
                    {e.stop_reason && <p className="text-xs text-muted-foreground mt-1 max-w-[16rem]">{e.stop_reason}</p>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {e.sends.length} of {sequence.steps.length}
                    {e.sends.at(-1) && <p className="text-xs text-muted-foreground">last {when(e.sends.at(-1)!.at)}</p>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {e.status === 'active' && e.next_send_at ? (
                      <>
                        Email {e.next_step + 1}, from {when(e.next_send_at)}
                      </>
                    ) : e.status === 'replied' ? (
                      `Replied ${when(e.replied_at)}`
                    ) : (
                      '—'
                    )}
                  </td>
                  {personal && (
                    <td className="px-4 py-3">
                      {e.personal ? (
                        <button
                          type="button"
                          onClick={() => setOpen(open === e.id ? null : e.id)}
                          aria-expanded={open === e.id}
                          aria-label={`${open === e.id ? 'Hide' : 'Show'} ${e.name ?? e.contact_email}'s first email`}
                          className="inline-flex items-center gap-1"
                        >
                          {open === e.id ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          <FirstEmailBadge e={e} />
                        </button>
                      ) : (
                        <FirstEmailBadge e={e} />
                      )}
                    </td>
                  )}
                </tr>
                {personal && open === e.id && (
                  <tr className="border-b border-border last:border-0 bg-muted/20">
                    <td />
                    <td colSpan={5} className="px-4 py-4">
                      <PersonalDraftPanel sequence={sequence} e={e} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sequence.status !== 'active' && data.some((e) => e.status === 'active') && (
        <p className="text-xs text-muted-foreground">Nothing sends until the sequence is running.</p>
      )}
      {adding && <EnrollDialog sequenceId={sequence.id} onClose={() => setAdding(false)} />}
    </div>
  )
}
