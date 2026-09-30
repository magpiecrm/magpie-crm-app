import type { ReactNode } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Mail, Plus, UserMinus } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { deleteCompanyFn, getCompanyFn, setContactCompanyFn, updateCompanyFn } from '../../../server/functions'
import { Avatar } from '../../../components/ui/Avatar'
import { Badge } from '../../../components/ui/Badge'
import { ActivityTimeline } from '../../../features/sales/components/ActivityTimeline'
import { FollowUpButton } from '../../../features/sales/components/TaskParts'
import { CompanyAbout, CompanyHeader, type CompanyChanges } from '../../../features/sales/components/CompanyHeader'
import { useInvalidateSales, usePipelines } from '../../../features/sales/usePipelines'
import { formatMoney, type DealStatus, type DealView } from '../../../features/sales/types'

export const Route = createFileRoute('/marketing/companies/$id')({
  component: CompanyPage,
})

type CompanyContact = Awaited<ReturnType<typeof getCompanyFn>>['contacts'][number]

const STATUS: Record<DealStatus, { label: string; variant: 'info' | 'success' | 'error' }> = {
  open: { label: 'Open', variant: 'info' },
  won: { label: 'Won', variant: 'success' },
  lost: { label: 'Lost', variant: 'error' },
}

function Section({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-xl">
      <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">
          {title}
          {count !== undefined && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h2>
        {action}
      </header>
      {children}
    </section>
  )
}

function CompanyPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: sales } = usePipelines()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.sales.company(id),
    queryFn: () => getCompanyFn({ data: { id } }),
  })

  // The company's name and totals show on the companies list, deal lists and deal pages.
  const invalidate = useInvalidateSales()

  const update = useMutation({
    mutationFn: (changes: CompanyChanges) => updateCompanyFn({ data: { id, changes } }),
    onSuccess: () => invalidate(),
  })
  const save = (changes: CompanyChanges) => update.mutateAsync(changes)

  const remove = useMutation({
    mutationFn: () => deleteCompanyFn({ data: { id } }),
    onSuccess: async () => {
      // Leave first, so this page doesn't refetch a company that's gone.
      await navigate({ to: '/marketing/companies' })
      queryClient.removeQueries({ queryKey: queryKeys.sales.company(id) })
      void invalidate()
    },
  })

  if (isLoading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
        <div className="h-5 w-32 bg-muted animate-pulse rounded" />
        <div className="h-40 bg-muted animate-pulse rounded-xl" />
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-72 bg-muted animate-pulse rounded-xl" />
          <div className="h-72 bg-muted animate-pulse rounded-xl" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto text-center space-y-3">
        <p className="text-muted-foreground">{error?.message ?? 'Company not found.'}</p>
        <Link to="/marketing/companies" className="text-sm font-semibold text-accent hover:underline">
          Back to companies
        </Link>
      </div>
    )
  }

  const { company, contacts, deals, activities } = data

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <Link
        to="/marketing/companies"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors group mb-4"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to companies
      </Link>

      <CompanyHeader
        company={company}
        owners={sales?.owners ?? []}
        onSave={save}
        onDelete={() => remove.mutate()}
        deleting={remove.isPending}
        deleteError={remove.error?.message ?? null}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6 items-start">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          <Section title="About">
            <div className="p-5">
              <CompanyAbout notes={company.notes} onSave={(notes) => save({ notes })} />
            </div>
          </Section>
          <Section title="Activity" action={<FollowUpButton on={{ companyId: id }} name={company.name} onAdded={() => void refetch()} />}>
            <div className="p-5">
              <ActivityTimeline activities={activities} on={{ companyId: id }} onChanged={() => void refetch()} />
            </div>
          </Section>
        </div>

        <div className="space-y-6 min-w-0">
          <CompanyDeals companyId={id} deals={deals} />
          <CompanyContacts contacts={contacts} onChanged={invalidate} />
        </div>
      </div>
    </div>
  )
}

function CompanyDeals({ companyId, deals }: { companyId: string; deals: DealView[] }) {
  return (
    <Section
      title="Deals"
      count={deals.length}
      action={
        <Link
          to="/sales/pipeline"
          search={{ new: 1, companyId }}
          className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
        >
          <Plus className="w-3.5 h-3.5" />
          New deal
        </Link>
      }
    >
      {deals.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground text-center">No deals with this company yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {deals.map((d) => (
            <li key={d.id}>
              <Link
                to="/sales/deals/$id"
                params={{ id: d.id }}
                className="flex items-start justify-between gap-3 px-5 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{d.stage_name}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-sm font-semibold text-foreground tabular-nums">{formatMoney(d.value, d.currency)}</span>
                  <Badge variant={STATUS[d.status].variant}>{STATUS[d.status].label}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function CompanyContacts({ contacts, onChanged }: { contacts: CompanyContact[]; onChanged: () => void }) {
  const unlink = useMutation({
    mutationFn: (email: string) => setContactCompanyFn({ data: { email, companyId: null } }),
    onSuccess: () => onChanged(),
  })

  return (
    <Section title="Contacts" count={contacts.length}>
      {contacts.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground text-center">No contacts at this company.</p>
      ) : (
        <ul className="divide-y divide-border">
          {contacts.map((c) => (
            <li key={c.email} className="group flex items-start gap-3 px-5 py-3">
              <Avatar name={c.name || c.email} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{c.name || c.email}</p>
                {c.job_title && <p className="text-xs text-muted-foreground truncate">{c.job_title}</p>}
                <a
                  href={`mailto:${c.email}`}
                  className="text-xs text-muted-foreground hover:text-accent truncate flex items-center gap-1.5 transition-colors"
                >
                  <Mail className="w-3 h-3 shrink-0" />
                  <span className="truncate">{c.email}</span>
                </a>
                {unlink.error && unlink.variables === c.email && (
                  <p className="text-xs text-destructive mt-1">{unlink.error.message}</p>
                )}
              </div>
              <button
                type="button"
                title="Remove from company"
                aria-label={`Remove ${c.email} from company`}
                disabled={unlink.isPending && unlink.variables === c.email}
                onClick={() => unlink.mutate(c.email)}
                className="touch-target shrink-0 flex items-center justify-center p-1.5 rounded-md-xs text-muted-foreground md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all cursor-pointer disabled:opacity-50"
              >
                <UserMinus className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
