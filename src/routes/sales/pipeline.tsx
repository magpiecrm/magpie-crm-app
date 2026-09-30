import { useCallback, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { queryKeys } from '../../queryKeys'
import { dealsFn } from '../../server/functions'
import { Button } from '../../components/ui/Button'
import { FIELD_CLASS } from '../../features/sales/forms'
import { usePipelines } from '../../features/sales/usePipelines'
import { formatMoney, type DealView } from '../../features/sales/types'
import { openStages } from '../../features/sales/utils'
import { PipelineBoard, STAGE_COLUMN_WIDTH } from '../../features/sales/components/PipelineBoard'
import { DealForm } from '../../features/sales/components/DealForm'
import { useCurrentUserEmail } from '../../features/sales/components/useSalesLookups'
import { Select } from '../../components/ui/Select'

interface PipelineSearch {
  /** Which pipeline to show; the first when missing. */
  pipeline?: string
  /** `?new=1` opens the New deal form, prefilled from `companyId` and `contact`. */
  new?: 1
  companyId?: string
  contact?: string
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export const Route = createFileRoute('/sales/pipeline')({
  validateSearch: (search: Record<string, unknown>): PipelineSearch => ({
    pipeline: str(search.pipeline),
    new: search.new === 1 || search.new === '1' || search.new === true ? 1 : undefined,
    companyId: str(search.companyId),
    contact: str(search.contact),
  }),
  component: PipelinePage,
})

function PipelinePage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const me = useCurrentUserEmail()
  const { data: pipelineData, isLoading: loadingPipelines, error: pipelinesError } = usePipelines()
  const pipelines = pipelineData?.pipelines ?? []
  const owners = pipelineData?.owners ?? []
  const pipeline = pipelines.find((p) => p.id === search.pipeline) ?? pipelines[0]

  const [owner, setOwner] = useState('') // '', 'me' or an email
  const [q, setQ] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const showForm = formOpen || search.new === 1

  const dealsKey = queryKeys.sales.deals({ pipelineId: pipeline?.id })
  const { data: deals = [], isLoading: loadingDeals } = useQuery({
    queryKey: dealsKey,
    queryFn: () => dealsFn({ data: { pipelineId: pipeline!.id } }),
    enabled: !!pipeline,
  })

  const ownerEmail = owner === 'me' ? me : owner || null
  const term = q.trim().toLowerCase()
  const isShown = useCallback(
    (d: DealView) =>
      (!ownerEmail || d.owner === ownerEmail) &&
      (!term || [d.name, d.company_name, ...d.contacts.flatMap((c) => [c.email, c.name])].some((v) => v?.toLowerCase().includes(term))),
    [ownerEmail, term],
  )

  const open = useMemo(() => deals.filter((d) => d.status === 'open' && isShown(d)), [deals, isShown])
  const probability = useMemo(() => new Map(pipeline?.stages.map((s) => [s.id, s.probability])), [pipeline])
  const openTotal = open.reduce((n, d) => n + d.value, 0)
  const weighted = Math.round(open.reduce((n, d) => n + (d.value * (probability.get(d.stage_id) ?? 0)) / 100, 0))

  const closeForm = () => {
    setFormOpen(false)
    if (search.new || search.companyId || search.contact) {
      navigate({ search: (prev) => ({ pipeline: prev.pipeline }), replace: true })
    }
  }

  const loading = loadingPipelines || (!!pipeline && loadingDeals)

  return (
    <div className="p-4 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-display text-foreground mb-1">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? (
              'Loading deals…'
            ) : (
              <>
                {open.length} open {open.length === 1 ? 'deal' : 'deals'} worth <span className="text-foreground font-medium">{formatMoney(openTotal)}</span>
                <span className="hidden sm:inline">
                  {' '}
                  · <span title="Each deal's value times its stage's chance of winning">{formatMoney(weighted)} weighted</span>
                </span>
              </>
            )}
          </p>
        </div>
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setFormOpen(true)} disabled={!pipeline} className="self-start sm:self-auto">
          New deal
        </Button>
      </div>

      {pipelines.length > 1 && (
        <div className="border-b border-border mb-4">
          <nav className="flex gap-6 -mb-px overflow-x-auto scrollbar-none" aria-label="Pipelines">
            {pipelines.map((p) => {
              const active = p.id === pipeline?.id
              return (
                <Link
                  key={p.id}
                  to="/sales/pipeline"
                  search={{ pipeline: p.id }}
                  aria-current={active ? 'page' : undefined}
                  className={`pb-3 text-sm whitespace-nowrap border-b-2 transition-colors ${
                    active ? 'font-semibold border-accent text-accent' : 'font-medium border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.name}
                </Link>
              )
            })}
          </nav>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative sm:w-72">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search deals, companies, people"
            aria-label="Search deals"
            className={`${FIELD_CLASS} pl-9`}
          />
        </div>
        <Select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" className={`${FIELD_CLASS} sm:w-56`}>
          <option value="">All owners</option>
          <option value="me">Me</option>
          {owners
            .filter((o) => o !== me)
            .map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
        </Select>
      </div>

      {pipelinesError ? (
        <p className="text-sm text-destructive">{pipelinesError.message}</p>
      ) : loading || !pipeline ? (
        <BoardSkeleton />
      ) : deals.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 sm:p-12 text-center">
          <p className="text-foreground font-medium">No deals in {pipeline.name} yet.</p>
          <p className="text-sm text-muted-foreground mt-1 mb-5">Add one and drag it along as it moves forward.</p>
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setFormOpen(true)}>
            New deal
          </Button>
        </div>
      ) : (
        <>
          {(term || ownerEmail) && !deals.some(isShown) && <p className="text-sm text-muted-foreground mb-3">No deals match these filters.</p>}
          <PipelineBoard pipeline={pipeline} deals={deals} isShown={isShown} queryKey={dealsKey} />
        </>
      )}

      <DealForm
        isOpen={showForm && !!pipeline}
        onClose={closeForm}
        initial={{
          pipelineId: pipeline?.id,
          stageId: pipeline ? openStages(pipeline)[0]?.id : undefined,
          companyId: search.companyId ?? null,
          contactEmails: search.contact ? [search.contact.toLowerCase()] : [],
        }}
      />
    </div>
  )
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={`${STAGE_COLUMN_WIDTH} rounded-xl border border-border bg-muted/40 p-3 space-y-3`}>
          <div className="h-4 w-24 bg-muted animate-pulse rounded" />
          <div className="h-3 w-16 bg-muted animate-pulse rounded" />
          {Array.from({ length: 3 - (i % 2) }).map((_, j) => (
            <div key={j} className="h-24 bg-card border border-border animate-pulse rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  )
}
