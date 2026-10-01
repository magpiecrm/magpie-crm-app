import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowLeft, Pause, Play, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { deleteSequenceFn, sequenceFn, setSequenceStatusFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { SEQUENCE_STATUS, percent } from '../../../features/sequences/components/labels'
import { StepsEditor } from '../../../features/sequences/components/StepsEditor'
import { PeopleTable } from '../../../features/sequences/components/PeopleTable'
import { SequenceSettingsForm } from '../../../features/sequences/components/SequenceSettingsForm'

type Tab = 'emails' | 'people' | 'settings'

export const Route = createFileRoute('/sales/sequences/$id')({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: search.tab === 'people' || search.tab === 'settings' ? search.tab : undefined,
  }),
  component: SequencePage,
})

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'emails', label: 'Emails' },
  { id: 'people', label: 'People' },
  { id: 'settings', label: 'Settings' },
]

function SequencePage() {
  const { id } = Route.useParams()
  const { tab = 'emails' } = Route.useSearch()
  const navigate = useNavigate({ from: '/sales/sequences/$id' })
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: queryKeys.sequences.sequence(id), queryFn: () => sequenceFn({ data: { id } }) })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.sequence(id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.list() })
  }
  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'paused' | 'archived') => setSequenceStatusFn({ data: { id, status } }),
    onSuccess: refresh,
  })
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null)
  const remove = useMutation({
    mutationFn: () => deleteSequenceFn({ data: { id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.list() })
      navigate({ to: '/sales/sequences' })
    },
  })

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  if (error || !data) return <div className="p-8 text-sm text-destructive">{error?.message ?? 'Sequence not found'}</div>
  const { sequence: s, summary, notReady } = data
  const status = SEQUENCE_STATUS[s.status]

  return (
    <div className="p-4 lg:p-8 max-w-5xl">
      <Link to="/sales/sequences" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Sequences
      </Link>
      <header className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-2xl font-display text-foreground break-words">{s.name}</h1>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {summary.enrolled} people · {summary.active} in progress · {summary.sent} emails sent · {summary.replied} replied ({percent(summary.replied, summary.enrolled)})
            {summary.bounced ? ` · ${summary.bounced} bounced` : ''}
          </p>
          {s.status === 'paused' && s.paused_reason && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{s.paused_reason}</p>}
          {s.status !== 'active' && s.status !== 'archived' && notReady && <p className="mt-2 text-sm text-muted-foreground">Before it can run: {notReady}</p>}
          {s.guess_gate?.status === 'waiting' && (
            <p className="mt-2 text-sm text-muted-foreground">
              Unconfirmed addresses wait until the first {s.guess_gate.first_batch} have had time to bounce, then carry on if few did.
            </p>
          )}
          {s.guess_gate?.status === 'stopped' && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
              {s.guess_gate.hard_bounces} of the first {s.guess_gate.first_batch} unconfirmed addresses bounced, so the rest aren't emailed. Confirmed
              addresses carry on.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {s.status === 'active' ? (
            <Button variant="secondary" leftIcon={<Pause className="w-4 h-4" />} isLoading={setStatus.isPending} onClick={() => setStatus.mutate('paused')}>
              Pause
            </Button>
          ) : s.status !== 'archived' ? (
            <Button leftIcon={<Play className="w-4 h-4" />} isLoading={setStatus.isPending} disabled={!!notReady} onClick={() => setStatus.mutate('active')}>
              {s.status === 'draft' ? 'Start sending' : 'Resume'}
            </Button>
          ) : null}
          {s.status !== 'archived' &&
            (confirm === 'archive' ? (
              <>
                <Button variant="danger" size="sm" onClick={() => setStatus.mutate('archived', { onSuccess: () => setConfirm(null) })}>
                  Archive: stops everyone
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                  Keep
                </Button>
              </>
            ) : summary.sent === 0 ? (
              confirm === 'delete' ? (
                <>
                  <Button variant="danger" size="sm" isLoading={remove.isPending} onClick={() => remove.mutate()}>
                    Delete
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" leftIcon={<Trash2 className="w-4 h-4" />} onClick={() => setConfirm('delete')}>
                  Delete
                </Button>
              )
            ) : (
              <Button variant="ghost" size="sm" leftIcon={<Archive className="w-4 h-4" />} onClick={() => setConfirm('archive')}>
                Archive
              </Button>
            ))}
        </div>
      </header>
      {setStatus.error && <p className="text-sm text-destructive mb-4">{(setStatus.error as Error).message}</p>}

      <div className="border-b border-border mb-6">
        <nav className="flex gap-6 -mb-px" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => navigate({ search: { tab: t.id === 'emails' ? undefined : t.id }, replace: true })}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`pb-3 text-sm whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id ? 'font-semibold border-accent text-accent' : 'font-medium border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {t.id === 'people' && summary.enrolled ? <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{summary.enrolled}</span> : null}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'emails' && <StepsEditor sequence={s} stats={data.stepStats} />}
      {tab === 'people' && <PeopleTable sequence={s} />}
      {tab === 'settings' && <SequenceSettingsForm sequence={s} />}
    </div>
  )
}
