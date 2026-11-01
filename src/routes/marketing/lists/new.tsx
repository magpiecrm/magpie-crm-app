import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { ActiveFilters, AddFilterButton, newFilter } from '../../../features/contacts/components/ContactFilters'
import { SelectionNotes, WhoCanBeEmailed } from '../../../features/contacts/components/ListPreviewCounts'
import { filterProblems, type ContactFilter } from '../../../features/contacts/contactFilters'
import { queryKeys } from '../../../queryKeys'
import { buildListFn, listFilterFieldsFn } from '../../../server/functions'

export const Route = createFileRoute('/marketing/lists/new')({
  component: BuildListPage,
})

const asked = (filters: ContactFilter[]) => JSON.stringify(filters.map((f) => [f.field, f.op, f.value, f.values]))

function BuildListPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [filters, setFilters] = useState<ContactFilter[]>([])
  const [menuOpen, setMenuOpen] = useState(false)

  const { data: fields = [], isLoading } = useQuery({
    queryKey: queryKeys.email.listFilterFields(),
    queryFn: () => listFilterFieldsFn(),
    staleTime: 0,
  })

  const [problem] = filterProblems(filters, fields)
  const check = useMutation({ mutationFn: (current: ContactFilter[]) => buildListFn({ data: { filters: current, dryRun: true } }) })
  const filterKey = asked(filters)
  useEffect(() => {
    if (problem) return check.reset()
    const timer = setTimeout(() => check.mutate(filters), 300)
    return () => clearTimeout(timer)
  }, [filterKey, problem])

  // What's shown is only the answer to the filters as they are now.
  const preview = check.isSuccess && check.variables && asked(check.variables) === filterKey ? check.data : null

  const create = useMutation({
    mutationFn: () => buildListFn({ data: { name: name.trim(), filters } }),
    onSuccess: (list) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      if ('id' in list) navigate({ to: '/marketing/lists/$listId', params: { listId: String(list.id) } })
    },
  })

  const hints = filters.flatMap((f) => {
    const field = fields.find((x) => x.key === f.field)
    return field?.hint ? [{ label: field.label, hint: field.hint }] : []
  })
  const distinctHints = hints.filter((h, i) => hints.findIndex((x) => x.label === h.label) === i)

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-8">
        <Link to="/marketing/lists" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors mb-4 group w-fit">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to lists
        </Link>
        <h1 className="text-2xl font-display text-foreground mb-2">Build a list from contacts</h1>
        <p className="text-muted-foreground">Pick people you already have, by country, job title and more. It finds nobody new and uses no credits.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-6 items-start">
        <div className="card border border-border p-5 space-y-5">
          <Field label="List name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. UK founders" maxLength={200} className={INPUT_CLASS} />
          </Field>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Who to include</p>
            <ActiveFilters filters={filters} fields={fields} onChange={setFilters} />
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : (
              <AddFilterButton fields={fields} open={menuOpen} onOpenChange={setMenuOpen} onAdd={(field) => setFilters((all) => [...all, newFilter(field, true)])} />
            )}
            {filters.length > 1 && <p className="text-xs text-muted-foreground mt-3">Someone has to pass every filter to be included.</p>}
          </div>
        </div>

        <aside className="card border border-border p-5 space-y-3 lg:sticky lg:top-6" aria-live="polite">
          {filters.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add a filter to see who matches.</p>
          ) : problem ? (
            <p className="text-sm text-muted-foreground">{problem}</p>
          ) : check.isError ? (
            <Notice level="error">{check.error.message}</Notice>
          ) : !preview ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Counting
            </p>
          ) : (
            <>
              <div>
                <p className="text-3xl font-display text-foreground">{preview.matched.toLocaleString('en-GB')}</p>
                <p className="text-sm text-muted-foreground">{preview.matched === 1 ? 'contact matches' : 'contacts match'}</p>
              </div>
              {preview.matched > 0 && <WhoCanBeEmailed preview={preview} />}
              <SelectionNotes preview={preview} />
            </>
          )}
          {distinctHints.map((h) => (
            <p key={h.label} className="text-xs text-muted-foreground">
              <span className="font-semibold">{h.label}:</span> {h.hint}
            </p>
          ))}
          {create.isError && <Notice level="error">{create.error.message}</Notice>}
          <Button
            className="w-full"
            isLoading={create.isPending}
            disabled={!preview || preview.toAdd === 0 || !name.trim()}
            onClick={() => create.mutate()}
          >
            {preview?.toAdd ? `Create list of ${preview.toAdd.toLocaleString('en-GB')}` : 'Create list'}
          </Button>
          {preview && preview.toAdd > 0 && !name.trim() && <p className="text-xs text-muted-foreground">Give the list a name to create it.</p>}
        </aside>
      </div>
    </div>
  )
}
