import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getDealFn } from '../../../server/functions'
import { usePipelines } from '../../../features/sales/usePipelines'
import { formatDay } from '../../../features/sales/utils'
import { ActivityTimeline } from '../../../features/sales/components/ActivityTimeline'
import { FollowUpButton } from '../../../features/sales/components/TaskParts'
import { useCurrentUserEmail, useRefreshSales } from '../../../features/sales/components/useSalesLookups'
import {
  CloseDateField,
  CompanyPanel,
  DealName,
  DeleteDeal,
  LostReasonField,
  OwnerField,
  PeoplePanel,
  StageControl,
  StatusBadge,
  ValueField,
} from '../../../features/sales/components/DealDetails'

export const Route = createFileRoute('/sales/deals/$id')({
  component: DealPage,
})

function BackLink() {
  return (
    <Link to="/sales/deals" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors group mb-4">
      <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
      Back to deals
    </Link>
  )
}

function DealPage() {
  const { id } = Route.useParams()
  const me = useCurrentUserEmail()
  const refresh = useRefreshSales()
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.sales.deal(id),
    queryFn: () => getDealFn({ data: { id } }),
    retry: false,
  })
  const { data: pipelineData } = usePipelines()
  const pipelines = pipelineData?.pipelines ?? []
  const owners = pipelineData?.owners ?? []

  if (isLoading) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
        <div className="h-5 w-28 bg-muted animate-pulse rounded" />
        <div className="h-44 bg-muted animate-pulse rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-72 bg-muted animate-pulse rounded-xl" />
          <div className="h-72 bg-muted animate-pulse rounded-xl" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-4 lg:p-8 max-w-7xl mx-auto">
        <BackLink />
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          {error?.message === 'Deal not found' || !error ? "This deal doesn't exist. It may have been deleted." : error.message}
        </div>
      </div>
    )
  }

  const { deal, activities } = data

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      <BackLink />

      <header className="bg-card border border-border rounded-xl p-5 sm:p-6 mb-6 space-y-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <DealName deal={deal} />
            <StatusBadge deal={deal} />
          </div>
          <p className="text-xs text-muted-foreground">
            Created {formatDay(deal.created_at)}
            {deal.closed_at && ` · ${deal.status === 'won' ? 'Won' : 'Lost'} ${formatDay(deal.closed_at)}`}
          </p>
        </div>

        <StageControl deal={deal} pipelines={pipelines} activities={activities} />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5 border-t border-border">
          <ValueField deal={deal} />
          <OwnerField deal={deal} owners={owners} me={me} />
          <CloseDateField deal={deal} />
        </div>

        {deal.status === 'lost' && <LostReasonField deal={deal} />}
      </header>

      {/* Phones: company and people, then the timeline, then delete. Desktop: the timeline beside them. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 lg:grid-rows-[auto_1fr] gap-6 items-start">
        <div className="space-y-6 lg:col-start-3 lg:row-start-1">
          <CompanyPanel deal={deal} />
          <PeoplePanel deal={deal} />
        </div>
        <section className="lg:col-span-2 lg:col-start-1 lg:row-start-1 lg:row-span-2 bg-card border border-border rounded-xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-foreground">Activity</h2>
            <FollowUpButton on={{ dealId: deal.id }} name={deal.contacts[0]?.name ?? deal.company_name ?? deal.name} onAdded={() => refresh(deal.id)} />
          </div>
          <ActivityTimeline activities={activities} on={{ dealId: deal.id }} onChanged={() => refresh(deal.id)} />
        </section>
        <div className="lg:col-start-3 lg:row-start-2">
          <DeleteDeal deal={deal} />
        </div>
      </div>
    </div>
  )
}
