// The pieces of the deal page. Each control saves on its own and shows its
// own error next to it.

import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronRight, Mail, Pencil, RotateCcw, Trash2, Trophy, UserPlus, X, XCircle } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { deleteDealFn, moveDealFn, updateDealFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Badge } from '../../../components/ui/Badge'
import { Avatar } from '../../../components/ui/Avatar'
import { FIELD_CLASS } from '../forms'
import type { Activity, DealView, Pipeline } from '../types'
import { closedStage, isOverdue, openStages, penceToPounds, poundsToPence, STATUS_BADGE, STATUS_LABEL } from '../utils'
import { CompanyPicker } from './CompanyPicker'
import { ContactSearch } from './ContactPicker'
import { LostReasonDialog } from './LostReasonDialog'
import { useRefreshSales } from './useSalesLookups'

type DealChanges = Parameters<typeof updateDealFn>[0]['data']['changes']

const LABEL = 'block text-xs font-medium text-muted-foreground mb-1.5'
const ErrorText = ({ error }: { error: Error | null }) => (error ? <p className="text-xs text-destructive mt-1">{error.message}</p> : null)

/** Saves changes to a deal's details and refreshes what shows them. */
function useUpdateDeal(dealId: string) {
  const queryClient = useQueryClient()
  const refresh = useRefreshSales()
  return useMutation({
    mutationFn: (changes: DealChanges) => updateDealFn({ data: { id: dealId, changes } }),
    onSuccess: (deal) => {
      queryClient.setQueryData(queryKeys.sales.deal(dealId), (old: { deal: DealView; activities: Activity[] } | undefined) => (old ? { ...old, deal } : old))
      refresh(dealId)
    },
  })
}

/** Moves a deal to a stage (Won and Lost close it), logged in its history. */
function useMoveDeal(dealId: string) {
  const refresh = useRefreshSales()
  return useMutation({
    mutationFn: (to: { stageId: string; pipelineId?: string; lostReason?: string | null }) => moveDealFn({ data: { id: dealId, ...to } }),
    onSuccess: () => refresh(dealId),
  })
}

/* ------------------------------------------------------------- header */

export function DealName({ deal }: { deal: DealView }) {
  const save = useUpdateDeal(deal.id)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(deal.name)
  useEffect(() => setName(deal.name), [deal.name])

  const commit = () => {
    if (save.isPending) return
    const next = name.trim()
    if (!next) return setName(deal.name)
    if (next !== deal.name) save.mutate({ name: next }, { onSuccess: () => setEditing(false) })
    else setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex-1 min-w-0">
        <input
          autoFocus
          aria-label="Deal name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setName(deal.name)
              setEditing(false)
            }
          }}
          className={`${FIELD_CLASS} text-xl font-bold`}
        />
        <ErrorText error={save.error} />
      </div>
    )
  }
  return (
    <h1 className="min-w-0 text-2xl font-bold text-foreground tracking-tight">
      <button type="button" onClick={() => setEditing(true)} title="Rename" className="group inline-flex items-center gap-2 text-left break-words cursor-pointer">
        {deal.name}
        <Pencil className="w-4 h-4 text-muted-foreground lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-visible:opacity-100 transition-opacity shrink-0" />
      </button>
    </h1>
  )
}

export function StatusBadge({ deal }: { deal: DealView }) {
  return <Badge variant={STATUS_BADGE[deal.status]}>{STATUS_LABEL[deal.status]}</Badge>
}

/** Pipeline › stage, with a dropdown that moves the deal, and Won / Lost / Reopen. */
export function StageControl({ deal, pipelines, activities }: { deal: DealView; pipelines: Pipeline[]; activities: Activity[] }) {
  const move = useMoveDeal(deal.id)
  const [lostTo, setLostTo] = useState<{ pipelineId: string; stageId: string } | null>(null)
  const pipeline = pipelines.find((p) => p.id === deal.pipeline_id)
  const shown = pipelines.length > 1 ? pipelines : pipeline ? [pipeline] : []

  const goTo = (pipelineId: string, stageId: string) => {
    const target = pipelines.find((p) => p.id === pipelineId)?.stages.find((s) => s.id === stageId)
    if (!target) return
    if (target.kind === 'lost') return setLostTo({ pipelineId, stageId })
    move.mutate({ stageId, pipelineId: pipelineId !== deal.pipeline_id ? pipelineId : undefined })
  }

  // Reopening goes back to the stage it closed from, when that still exists.
  const reopenStage = () => {
    if (!pipeline) return undefined
    const closedFrom = activities.find((a) => a.kind === 'stage_change' && a.to_stage === deal.stage_name)?.from_stage
    return openStages(pipeline).find((s) => s.name === closedFrom) ?? openStages(pipeline)[0]
  }
  const won = pipeline && closedStage(pipeline, 'won')
  const lost = pipeline && closedStage(pipeline, 'lost')

  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <span className="text-muted-foreground shrink-0 max-w-[12rem] truncate">{deal.pipeline_name}</span>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        <select
          aria-label="Stage"
          value={`${deal.pipeline_id}:${deal.stage_id}`}
          disabled={move.isPending}
          onChange={(e) => {
            const [pipelineId, stageId] = e.target.value.split(':')
            if (pipelineId && stageId) goTo(pipelineId, stageId)
          }}
          className={`${FIELD_CLASS} w-auto py-1.5 font-medium`}
        >
          {shown.map((p) =>
            shown.length > 1 ? (
              <optgroup key={p.id} label={p.name}>
                {p.stages.map((s) => (
                  <option key={s.id} value={`${p.id}:${s.id}`}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ) : (
              p.stages.map((s) => (
                <option key={s.id} value={`${p.id}:${s.id}`}>
                  {s.name}
                </option>
              ))
            ),
          )}
        </select>
      </div>
      <div className="flex items-center gap-2 sm:ml-auto">
        {deal.status === 'open' ? (
          <>
            {won && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Trophy className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                disabled={move.isPending}
                onClick={() => move.mutate({ stageId: won.id })}
              >
                Won
              </Button>
            )}
            {lost && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<XCircle className="w-3.5 h-3.5 text-destructive" />}
                disabled={move.isPending}
                onClick={() => setLostTo({ pipelineId: deal.pipeline_id, stageId: lost.id })}
              >
                Lost
              </Button>
            )}
          </>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            isLoading={move.isPending}
            onClick={() => {
              const stage = reopenStage()
              if (stage) move.mutate({ stageId: stage.id })
            }}
          >
            Reopen
          </Button>
        )}
      </div>
      {move.error && <p className="text-xs text-destructive sm:basis-full">{move.error.message}</p>}
      <LostReasonDialog
        isOpen={!!lostTo}
        dealName={deal.name}
        isSaving={move.isPending}
        onCancel={() => setLostTo(null)}
        onConfirm={(reason) => {
          if (!lostTo) return
          move.mutate(
            { stageId: lostTo.stageId, pipelineId: lostTo.pipelineId !== deal.pipeline_id ? lostTo.pipelineId : undefined, lostReason: reason },
            { onSettled: () => setLostTo(null) },
          )
        }}
      />
    </div>
  )
}

export function ValueField({ deal }: { deal: DealView }) {
  const save = useUpdateDeal(deal.id)
  const [value, setValue] = useState(penceToPounds(deal.value))
  useEffect(() => setValue(penceToPounds(deal.value)), [deal.value])
  const pence = poundsToPence(value)
  const commit = () => {
    if (pence === null || save.isPending) return
    if (pence !== deal.value) save.mutate({ value: pence })
  }
  return (
    <div>
      <label htmlFor="deal-value" className={LABEL}>
        Value
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">£</span>
        <input
          id="deal-value"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          aria-invalid={pence === null}
          className={`${FIELD_CLASS} pl-7 tabular-nums`}
        />
      </div>
      {pence === null ? <p className="text-xs text-destructive mt-1">Enter an amount in pounds.</p> : <ErrorText error={save.error} />}
    </div>
  )
}

export function OwnerField({ deal, owners, me }: { deal: DealView; owners: string[]; me: string | null }) {
  const save = useUpdateDeal(deal.id)
  const options = deal.owner && !owners.includes(deal.owner) ? [deal.owner, ...owners] : owners
  return (
    <div>
      <label htmlFor="deal-owner" className={LABEL}>
        Owner
      </label>
      <select id="deal-owner" value={deal.owner ?? ''} disabled={save.isPending} onChange={(e) => save.mutate({ owner: e.target.value || null })} className={FIELD_CLASS}>
        <option value="">No owner</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o === me ? `${o} (you)` : o}
          </option>
        ))}
      </select>
      <ErrorText error={save.error} />
    </div>
  )
}

export function CloseDateField({ deal }: { deal: DealView }) {
  const save = useUpdateDeal(deal.id)
  const overdue = isOverdue(deal)
  return (
    <div>
      <label htmlFor="deal-close" className={LABEL}>
        Expected close {overdue && <span className="text-destructive">· overdue</span>}
      </label>
      <input
        id="deal-close"
        type="date"
        value={deal.expected_close ?? ''}
        onChange={(e) => {
          const v = e.target.value
          if (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)) save.mutate({ expectedClose: v || null })
        }}
        className={`${FIELD_CLASS} ${overdue ? 'text-destructive' : ''}`}
      />
      <ErrorText error={save.error} />
    </div>
  )
}

export function LostReasonField({ deal }: { deal: DealView }) {
  const save = useUpdateDeal(deal.id)
  const [reason, setReason] = useState(deal.lost_reason ?? '')
  useEffect(() => setReason(deal.lost_reason ?? ''), [deal.lost_reason])
  return (
    <div>
      <label htmlFor="deal-lost-reason" className={LABEL}>
        Why it was lost
      </label>
      <textarea
        id="deal-lost-reason"
        rows={2}
        maxLength={500}
        value={reason}
        placeholder="No reason given"
        onChange={(e) => setReason(e.target.value)}
        onBlur={() => {
          const next = reason.trim() || null
          if (next !== (deal.lost_reason ?? null)) save.mutate({ lostReason: next })
        }}
        className={`${FIELD_CLASS} resize-y`}
      />
      <ErrorText error={save.error} />
    </div>
  )
}

/* ------------------------------------------------------------- side panels */

const PANEL = 'bg-card border border-border rounded-xl p-5'
const PANEL_TITLE = 'text-sm font-semibold text-foreground'

export function CompanyPanel({ deal }: { deal: DealView }) {
  const save = useUpdateDeal(deal.id)
  const [changing, setChanging] = useState(false)

  return (
    <section className={PANEL}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className={PANEL_TITLE}>Company</h2>
        {deal.company_id && !changing && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
              Change
            </Button>
            <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ companyId: null })}>
              Remove
            </Button>
          </div>
        )}
      </div>
      {deal.company_id && !changing ? (
        <Link
          to="/marketing/companies/$id"
          params={{ id: deal.company_id }}
          className="flex items-center gap-3 p-2 -m-2 rounded-lg hover:bg-muted/50 transition-colors"
        >
          <span className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4" />
          </span>
          <span className="font-medium text-foreground truncate">{deal.company_name ?? 'Company'}</span>
        </Link>
      ) : (
        <div className="space-y-2">
          <CompanyPicker
            value={null}
            autoFocus={changing}
            onChange={(companyId) => {
              if (companyId) save.mutate({ companyId }, { onSuccess: () => setChanging(false) })
            }}
          />
          {changing && (
            <Button size="sm" variant="ghost" onClick={() => setChanging(false)}>
              Cancel
            </Button>
          )}
        </div>
      )}
      <ErrorText error={save.error} />
    </section>
  )
}

export function PeoplePanel({ deal }: { deal: DealView }) {
  const save = useUpdateDeal(deal.id)
  const [adding, setAdding] = useState(false)
  // Only contacts that still exist: the server refuses addresses that aren't contacts.
  const emails = deal.contacts.map((c) => c.email)

  return (
    <section className={PANEL}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className={PANEL_TITLE}>People</h2>
        {!adding && (
          <Button size="sm" variant="ghost" leftIcon={<UserPlus className="w-3.5 h-3.5" />} onClick={() => setAdding(true)}>
            Add
          </Button>
        )}
      </div>
      {deal.contacts.length === 0 && !adding && <p className="text-sm text-muted-foreground">No one yet.</p>}
      {deal.contacts.length > 0 && (
        <ul className="space-y-3 mb-1">
          {deal.contacts.map((c) => (
            <li key={c.email} className="group flex items-center gap-3">
              <Avatar name={c.name ?? c.email} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{c.name ?? c.email}</p>
                <a href={`mailto:${c.email}`} className="text-xs text-muted-foreground hover:text-accent truncate flex items-center gap-1">
                  <Mail className="w-3 h-3 shrink-0" />
                  <span className="truncate">{c.email}</span>
                </a>
              </div>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate({ contactEmails: emails.filter((e) => e !== c.email) })}
                aria-label={`Remove ${c.name ?? c.email} from this deal`}
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="space-y-2 mt-3">
          <ContactSearch autoFocus exclude={emails} onPick={(email) => save.mutate({ contactEmails: [...emails, email] }, { onSuccess: () => setAdding(false) })} />
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Done
          </Button>
        </div>
      )}
      <ErrorText error={save.error} />
    </section>
  )
}

export function DeleteDeal({ deal }: { deal: DealView }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const refresh = useRefreshSales()
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({
    mutationFn: () => deleteDealFn({ data: { id: deal.id } }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.sales.deal(deal.id) })
      refresh()
      navigate({ to: '/sales/deals' })
    },
  })

  return (
    <section className={PANEL}>
      {confirming ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">Delete this deal? Its notes and history go with it.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" isLoading={remove.isPending} onClick={() => remove.mutate()}>
              Yes, delete
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
          <ErrorText error={remove.error} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
          Delete deal
        </button>
      )}
    </section>
  )
}
