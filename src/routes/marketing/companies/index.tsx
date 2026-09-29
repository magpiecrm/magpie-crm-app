import { useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Building2, Plus, Search } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { companiesFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { Pagination } from '../../../components/ui/Pagination'
import type { ExportColumn } from '../../../utils/export'
import { CompanyForm } from '../../../features/sales/components/CompanyForm'
import { formatMoney, type CompanyView } from '../../../features/sales/types'
import { shortDate } from '../../../features/sales/forms'

export const Route = createFileRoute('/marketing/companies/')({
  component: CompaniesPage,
})

type Sort = 'updated' | 'name'

const EXPORT_COLUMNS: ExportColumn<CompanyView>[] = [
  { header: 'Company', value: (c) => c.name },
  { header: 'Domain', value: (c) => c.domain },
  { header: 'Industry', value: (c) => c.industry },
  { header: 'Staff', value: (c) => c.headcount },
  { header: 'Contacts', value: (c) => c.contacts },
  { header: 'Open deals', value: (c) => c.open_deals },
  { header: 'Open value (£)', value: (c) => c.open_value / 100 },
  { header: 'Owner', value: (c) => c.owner },
  { header: 'Updated', value: (c) => c.updated_at.slice(0, 10) },
]

const TH = 'px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider'

function CompaniesPage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('updated')
  const [showForm, setShowForm] = useState(false)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)

  const { data: companies = [], isLoading, error } = useQuery({
    queryKey: queryKeys.sales.companies(),
    queryFn: () => companiesFn(),
  })

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    const matching = term
      ? companies.filter((c) => [c.name, c.domain, c.industry, c.owner].some((v) => v?.toLowerCase().includes(term)))
      : companies
    return sort === 'name' ? [...matching].sort((a, b) => a.name.localeCompare(b.name)) : matching
  }, [companies, q, sort])
  const pageRows = shown.slice((page - 1) * perPage, page * perPage)

  const open = (id: string) => navigate({ to: '/marketing/companies/$id', params: { id } })
  const empty = !isLoading && companies.length === 0

  return (
    <div className="p-4 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-2">Companies</h1>
          <p className="text-muted-foreground">The organisations your contacts work at and your deals are with.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportMenu filename="companies" sheetName="Companies" rows={shown} columns={EXPORT_COLUMNS} />
          <Button onClick={() => setShowForm(true)} leftIcon={<Plus className="w-4 h-4" />}>
            New company
          </Button>
        </div>
      </div>

      {empty ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center flex flex-col items-center gap-4">
          <span className="p-3 rounded-full bg-accent/10 text-accent">
            <Building2 className="w-6 h-6" />
          </span>
          <div className="space-y-1 max-w-md">
            <p className="font-semibold text-foreground">No companies yet</p>
            <p className="text-sm text-muted-foreground">
              Companies are made automatically from your contacts' work email addresses. You can also add one yourself.
            </p>
          </div>
          <Button onClick={() => setShowForm(true)} leftIcon={<Plus className="w-4 h-4" />}>
            New company
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search companies"
                aria-label="Search companies"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage(1)
                }}
                className="w-full sm:w-72 pl-10 pr-4 py-2 border border-border rounded-xl text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Sort by
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="px-3 py-2 border border-border rounded-xl text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="updated">Recently updated</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>

          <div className="text-xs text-muted-foreground mb-4 font-medium">
            {isLoading ? 'Loading companies…' : `${shown.length} ${shown.length === 1 ? 'company' : 'companies'}`}
          </div>

          {error && <p className="text-sm text-destructive mb-4">{error.message}</p>}

          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            {/* Phones: cards */}
            <ul className="md:hidden divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="p-4 animate-pulse">
                    <div className="h-10 bg-muted rounded w-full" />
                  </li>
                ))
              ) : shown.length === 0 ? (
                <li className="p-8 text-center text-muted-foreground text-sm">No companies match your search.</li>
              ) : (
                pageRows.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/marketing/companies/$id"
                      params={{ id: c.id }}
                      className="block p-4 active:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate">{c.name}</p>
                          {c.domain && <p className="text-xs text-muted-foreground truncate">{c.domain}</p>}
                        </div>
                        {c.open_deals > 0 && (
                          <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">{formatMoney(c.open_value)}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {c.contacts} {c.contacts === 1 ? 'contact' : 'contacts'} · {c.open_deals} open{' '}
                        {c.open_deals === 1 ? 'deal' : 'deals'}
                        {c.owner && ` · ${c.owner}`}
                      </p>
                    </Link>
                  </li>
                ))
              )}
            </ul>

            {/* Wider screens: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className={TH}>Company</th>
                    <th className={`${TH} text-right`}>Contacts</th>
                    <th className={`${TH} text-right`}>Open deals</th>
                    <th className={`${TH} text-right`}>Open value</th>
                    <th className={TH}>Owner</th>
                    <th className={TH}>Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={6} className="px-6 py-5">
                          <div className="h-8 bg-muted rounded w-full" />
                        </td>
                      </tr>
                    ))
                  ) : shown.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                        No companies match your search.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((c) => (
                      <tr key={c.id} onClick={() => open(c.id)} className="hover:bg-muted/50 transition-colors cursor-pointer">
                        <td className="px-6 py-4">
                          <Link
                            to="/marketing/companies/$id"
                            params={{ id: c.id }}
                            onClick={(e) => e.stopPropagation()}
                            className="font-semibold text-foreground hover:text-accent transition-colors"
                          >
                            {c.name}
                          </Link>
                          {c.domain && <p className="text-xs text-muted-foreground">{c.domain}</p>}
                        </td>
                        <td className="px-6 py-4 text-sm text-foreground text-right tabular-nums">{c.contacts}</td>
                        <td className="px-6 py-4 text-sm text-foreground text-right tabular-nums">{c.open_deals}</td>
                        <td className="px-6 py-4 text-sm text-foreground text-right tabular-nums">
                          {c.open_deals > 0 ? formatMoney(c.open_value) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-6 py-4 text-sm text-foreground">
                          {c.owner ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-6 py-4 text-xs text-muted-foreground whitespace-nowrap">{shortDate(c.updated_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 md:px-6 pb-2">
              <Pagination
                totalItems={shown.length}
                itemsPerPage={perPage}
                onItemsPerPageChange={setPerPage}
                currentPage={page}
                onPageChange={setPage}
              />
            </div>
          </div>
        </>
      )}

      <CompanyForm isOpen={showForm} onClose={() => setShowForm(false)} onCreated={(c) => open(c.id)} />
    </div>
  )
}
