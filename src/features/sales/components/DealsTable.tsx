import { Link } from '@tanstack/react-router'
import { Avatar } from '../../../components/ui/Avatar'
import { Badge } from '../../../components/ui/Badge'
import type { ExportColumn } from '../../../utils/export'
import { formatMoney, type DealView } from '../types'
import { formatCloseDate, formatDay, isOverdue, nameFromEmail, STATUS_BADGE, STATUS_LABEL } from '../utils'

export const DEAL_EXPORT_COLUMNS: ExportColumn<DealView>[] = [
  { header: 'Deal', value: (d) => d.name },
  { header: 'Company', value: (d) => d.company_name },
  { header: 'Pipeline', value: (d) => d.pipeline_name },
  { header: 'Stage', value: (d) => d.stage_name },
  { header: 'Status', value: (d) => STATUS_LABEL[d.status] },
  { header: 'Value (£)', value: (d) => d.value / 100 },
  { header: 'Owner', value: (d) => d.owner },
  { header: 'People', value: (d) => d.contacts.map((c) => c.email).join('; ') },
  { header: 'Expected close', value: (d) => d.expected_close },
  { header: 'Lost reason', value: (d) => d.lost_reason },
  { header: 'Created', value: (d) => d.created_at.slice(0, 10) },
  { header: 'Updated', value: (d) => d.updated_at.slice(0, 10) },
]

const TH = 'px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap'

function CloseDate({ deal }: { deal: DealView }) {
  if (!deal.expected_close) return <span className="text-muted-foreground">—</span>
  return <span className={isOverdue(deal) ? 'text-destructive font-medium' : 'text-foreground'}>{formatCloseDate(deal.expected_close)}</span>
}

function Stage({ deal, showPipeline }: { deal: DealView; showPipeline: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      {deal.status !== 'open' ? <Badge variant={STATUS_BADGE[deal.status]}>{deal.stage_name}</Badge> : <span className="truncate">{deal.stage_name}</span>}
      {showPipeline && <span className="text-xs text-muted-foreground truncate">{deal.pipeline_name}</span>}
    </span>
  )
}

/** Deals as a table from md up, and as cards below it. */
export function DealsTable({ deals, isLoading, showPipeline, empty }: { deals: DealView[]; isLoading: boolean; showPipeline: boolean; empty: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <ul className="md:hidden divide-y divide-border">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="p-4">
              <div className="h-12 bg-muted animate-pulse rounded" />
            </li>
          ))
        ) : deals.length === 0 ? (
          <li className="p-8 text-center text-sm text-muted-foreground">{empty}</li>
        ) : (
          deals.map((deal) => (
            <li key={deal.id}>
              <Link to="/sales/deals/$id" params={{ id: deal.id }} className="block p-4 hover:bg-muted/50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{deal.name}</p>
                    {deal.company_name && <p className="text-xs text-muted-foreground truncate">{deal.company_name}</p>}
                  </div>
                  <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">{formatMoney(deal.value)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <Stage deal={deal} showPipeline={showPipeline} />
                  {deal.expected_close && (
                    <span>
                      Close <CloseDate deal={deal} />
                    </span>
                  )}
                  {deal.owner && <span className="truncate">{deal.owner}</span>}
                </div>
              </Link>
            </li>
          ))
        )}
      </ul>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className={TH}>Deal</th>
              <th className={TH}>Company</th>
              <th className={TH}>Stage</th>
              <th className={`${TH} text-right`}>Value</th>
              <th className={TH}>Owner</th>
              <th className={TH}>Expected close</th>
              <th className={TH}>Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={7} className="px-4 py-4">
                    <div className="h-8 bg-muted animate-pulse rounded" />
                  </td>
                </tr>
              ))
            ) : deals.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              deals.map((deal) => (
                <tr key={deal.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 max-w-64">
                    <Link to="/sales/deals/$id" params={{ id: deal.id }} className="font-semibold text-foreground hover:text-accent transition-colors truncate block">
                      {deal.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 max-w-48">
                    {deal.company_id && deal.company_name ? (
                      <Link to="/marketing/companies/$id" params={{ id: deal.company_id }} className="text-foreground hover:text-accent transition-colors truncate block">
                        {deal.company_name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-56">
                    <Stage deal={deal} showPipeline={showPipeline} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-foreground tabular-nums whitespace-nowrap">{formatMoney(deal.value)}</td>
                  <td className="px-4 py-3 max-w-56">
                    {deal.owner ? (
                      <span className="flex items-center gap-2 min-w-0" title={deal.owner}>
                        <Avatar name={nameFromEmail(deal.owner)} size="sm" />
                        <span className="truncate text-foreground">{deal.owner}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <CloseDate deal={deal} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDay(deal.updated_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
