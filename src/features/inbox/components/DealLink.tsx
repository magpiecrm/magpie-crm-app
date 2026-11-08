import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { Handshake, Plus } from 'lucide-react'
import { moveDealFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Select } from '../../../components/ui/Select'
import { DealForm } from '../../sales/components/DealForm'
import { useRefreshSales } from '../../sales/components/useSalesLookups'
import { usePipelines } from '../../sales/usePipelines'
import type { ConversationDeal } from '../../sequences/types'

/**
 * The person's deal, beside their conversation: a link to it and its stage,
 * which can be moved on from here (a lost deal needs its reason, so that's
 * done on the deal itself); or, without one, a button to start it.
 */
export function DealLink({ deal, email, companyId, onChanged }: { deal: ConversationDeal | null; email: string; companyId: string | null; onChanged: () => void }) {
  const [creating, setCreating] = useState(false)
  const { data } = usePipelines()
  const refreshSales = useRefreshSales()
  const move = useMutation({
    mutationFn: (stageId: string) => moveDealFn({ data: { id: deal!.id, stageId } }),
    onSuccess: () => {
      refreshSales(deal!.id)
      onChanged()
    },
  })

  if (!deal) {
    return (
      <>
        <Button variant="outline" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          Create deal
        </Button>
        <DealForm isOpen={creating} onClose={() => setCreating(false)} initial={{ contactEmails: [email], companyId }} onCreated={onChanged} />
      </>
    )
  }
  const stages = (data?.pipelines.find((p) => p.id === deal.pipeline_id)?.stages ?? []).filter((s) => s.kind !== 'lost' || s.id === deal.stage_id)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Link
        to="/sales/deals/$id"
        params={{ id: deal.id }}
        className="inline-flex min-w-0 items-center gap-1.5 text-sm text-foreground hover:underline"
        title="Open the deal"
      >
        <Handshake className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate max-w-40">{deal.name}</span>
      </Link>
      {stages.length > 0 ? (
        <Select
          value={deal.stage_id}
          onChange={(e) => e.target.value !== deal.stage_id && move.mutate(e.target.value)}
          disabled={move.isPending || deal.status === 'lost'}
          className="min-h-[32px] min-w-36 rounded-md-s border border-input bg-card px-2.5 py-1 text-xs text-foreground"
          aria-label="Deal stage"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      ) : (
        <span className="text-xs text-muted-foreground">{deal.stage}</span>
      )}
      {move.error && <span className="text-xs text-destructive">{move.error.message}</span>}
    </div>
  )
}
