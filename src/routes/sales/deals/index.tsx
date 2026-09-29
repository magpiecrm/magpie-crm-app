import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { dealsFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { Pagination } from '../../../components/ui/Pagination'
import { FIELD_CLASS } from '../../../features/sales/forms'
import { usePipelines } from '../../../features/sales/usePipelines'
import { formatMoney } from '../../../features/sales/types'
import { sumValue } from '../../../features/sales/utils'
import { DealForm } from '../../../features/sales/components/DealForm'
import { DEAL_EXPORT_COLUMNS, DealsTable } from '../../../features/sales/components/DealsTable'
import { useCurrentUserEmail } from '../../../features/sales/components/useSalesLookups'

type StatusFilter = 'open' | 'won' | 'lost' | 'all'

interface DealsSearch {
  /** Open when missing. */
  status?: Exclude<StatusFilter, 'open'>
  pipeline?: string
  /** 'me' or an owner's email. */
  owner?: string
  q?: string
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

export const Route = createFileRoute('/sales/deals/')({
  validateSearch: (search: Record<string, unknown>): DealsSearch => ({
    status: search.status === 'won' || search.status === 'lost' || search.status === 'all' ? search.status : undefined,
    pipeline: str(search.pipeline),
    owner: str(search.owner),
    q: str(search.q),
  }),
  component: DealsPage,
})

const STATUSES: Array<{ id: StatusFilter; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
  { id: 'all', label: 'All' },
]

function DealsPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/sales/deals/' })
  const me = useCurrentUserEmail()
  const { data: pipelineData } = usePipelines()
  const pipelines = pipelineData?.pipelines ?? []
  const owners = pipelineData?.owners ?? []
  const status: StatusFilter = search.status ?? 'open'

  const setSearch = (changes: Partial<DealsSearch>) => navigate({ search: (prev) => ({ ...prev, ...changes }), replace: true })

  // The search box updates the URL once typing pauses.
  const [q, setQ] = useState(search.q ?? '')
  useEffect(() => setQ((prev) => (prev.trim() === (search.q ?? '') ? prev : (search.q ?? ''))), [search.q])
  useEffect(() => {
    const next = q.trim() || undefined
    if (next === search.q) return
    const t = setTimeout(() => setSearch({ q: next }), 300)
    return () => clearTimeout(t)
  }, [q])

  const owner = search.owner === 'me' ? (me ?? undefined) : search.owner
  const filters = {
    status: status === 'all' ? undefined : status,
    pipelineId: search.pipeline,
    owner,
    q: search.q,
  }
  const { data = [], isLoading, error } = useQuery({
    queryKey: queryKeys.sales.deals(filters),
    queryFn: () => dealsFn({ data: filters }),
    // "Me" waits until we know who that is.
    enabled: search.owner !== 'me' || !!me,
  })
  const deals = useMemo(() => [...data].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [data])

  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  useEffect(() => setPage(1), [status, search.pipeline, search.owner, search.q])
  const pageRows = deals.slice((page - 1) * perPage, page * perPage)

  const [formOpen, setFormOpen] = useState(false)
  const loading = isLoading || (search.owner === 'me' && !me)
  const filtered = !!(search.pipeline || search.owner || search.q)

  return (
    <div className="p-4 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-1">Deals</h1>
          <p className="text-sm text-muted-foreground">Every deal across your pipelines.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportMenu filename={`deals_${status}`} sheetName="Deals" rows={deals} columns={DEAL_EXPORT_COLUMNS} />
          <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setFormOpen(true)}>
            New deal
          </Button>
        </div>
      </div>

      <div className="border-b border-border mb-4">
        <nav className="flex gap-6 -mb-px overflow-x-auto scrollbar-none" aria-label="Status">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSearch({ status: s.id === 'open' ? undefined : s.id })}
              aria-pressed={status === s.id}
              className={`pb-3 text-sm whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                status === s.id ? 'font-semibold border-accent text-accent' : 'font-medium border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <div className="relative md:w-72">
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
        <div className="flex gap-3">
          {pipelines.length > 1 && (
            <select value={search.pipeline ?? ''} onChange={(e) => setSearch({ pipeline: e.target.value || undefined })} aria-label="Pipeline" className={`${FIELD_CLASS} flex-1 md:flex-none md:w-48`}>
              <option value="">All pipelines</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <select value={search.owner ?? ''} onChange={(e) => setSearch({ owner: e.target.value || undefined })} aria-label="Owner" className={`${FIELD_CLASS} flex-1 md:flex-none md:w-56`}>
            <option value="">All owners</option>
            <option value="me">Me</option>
            {owners
              .filter((o) => o !== me)
              .map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
          </select>
        </div>
        {!loading && (
          <p className="text-sm text-muted-foreground md:ml-auto tabular-nums">
            {deals.length} {deals.length === 1 ? 'deal' : 'deals'} · <span className="font-semibold text-foreground">{formatMoney(sumValue(deals))}</span>
          </p>
        )}
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : (
        <DealsTable
          deals={pageRows}
          isLoading={loading}
          showPipeline={pipelines.length > 1}
          empty={filtered ? 'No deals match these filters.' : status === 'open' ? 'No open deals. Add one to get started.' : `No ${status === 'all' ? '' : `${status} `}deals yet.`}
        />
      )}

      {deals.length > 0 && (
        <Pagination totalItems={deals.length} itemsPerPage={perPage} onItemsPerPageChange={setPerPage} currentPage={page} onPageChange={setPage} />
      )}

      <DealForm
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        initial={{ pipelineId: search.pipeline }}
        onCreated={() => {
          if (status !== 'open' && status !== 'all') setSearch({ status: undefined })
        }}
      />
    </div>
  )
}
