import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, X } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { createCompanyFn } from '../../../server/functions'
import { SearchSelect } from './SearchSelect'
import { useCompanies } from './useSalesLookups'

/** Pick a company, or create one from the search text. */
export function CompanyPicker({
  value,
  onChange,
  autoFocus,
}: {
  value: string | null
  onChange: (companyId: string | null) => void
  autoFocus?: boolean
}) {
  const queryClient = useQueryClient()
  const { data: companies = [], isLoading } = useCompanies()
  const selected = value ? companies.find((c) => c.id === value) : undefined
  const options = useMemo(() => companies.map((c) => ({ id: c.id, label: c.name, sub: c.domain })), [companies])

  const create = useMutation({
    mutationFn: (name: string) => createCompanyFn({ data: { name } }),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sales.companies() })
      onChange(company.id)
    },
  })

  if (value) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg text-sm">
        <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {selected?.name ?? (isLoading ? 'Loading…' : 'Company')}
          {selected?.domain && <span className="text-muted-foreground"> · {selected.domain}</span>}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear company"
          className="p-0.5 rounded text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <SearchSelect
        options={options}
        onPick={onChange}
        placeholder="Search companies"
        onCreate={(name) => create.mutate(name)}
        createLabel={(name) => `Create company "${name}"`}
        isLoading={isLoading}
        isCreating={create.isPending}
        autoFocus={autoFocus}
        emptyText="No companies match."
      />
      {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}
    </div>
  )
}
