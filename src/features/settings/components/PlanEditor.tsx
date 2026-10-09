import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Notice } from '../../../components/ui/Notice'
import type { BillingStatus, Plan } from '../../../server/managedBilling'
import { capped, formatPence, monthlyPence, nearestStep, planChanges, unitPrice, PLAN_KINDS, type PlanChange } from '../planMath'
import { SettingsActions, SettingsList, SettingsRow } from './SettingsBlock'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

/**
 * Sliders for each kind the host sells, the monthly total, and a review step
 * that says what changes when before anything is charged.
 */
export function PlanEditor({
  billing,
  busy,
  onSubmit,
}: {
  billing: BillingStatus
  busy: boolean
  onSubmit: (plan: Plan) => void
}) {
  const { kinds, minimumPence } = billing.catalogue
  const current = billing.live ? billing.nextPlan : null
  // A first plan starts where the website's pricing does.
  const start: Plan = current ?? { prospects: 1250, reveals: 250, emails: 5000 }
  const [at, setAt] = useState<Record<string, number>>(() =>
    Object.fromEntries(kinds.map((k) => [k.id, nearestStep(k.steps, start[k.id])])),
  )
  const [reviewing, setReviewing] = useState(false)

  const planAt = (positions: Record<string, number>) => {
    const raw = Object.fromEntries(PLAN_KINDS.map((k) => [k, 0])) as Plan
    for (const k of kinds) raw[k.id] = k.steps[positions[k.id]] ?? 0
    return capped(raw, kinds)
  }
  const plan = useMemo(() => planAt(at), [at, kinds])
  const pence = monthlyPence(plan, kinds)
  const underMinimum = pence < minimumPence
  const { up, down } = planChanges(current, plan)
  const unchanged = billing.live && up.length === 0 && down.length === 0
  const nameOf = (id: string) => kinds.find((k) => k.id === id)?.name ?? id

  // Moving one slider can pull another down with it (reveals follow prospects).
  const move = (id: string, i: number) => {
    setReviewing(false)
    setAt((prev) => {
      const next = { ...prev, [id]: i }
      const fitted = planAt(next)
      for (const k of kinds) next[k.id] = nearestStep(k.steps, fitted[k.id])
      return next
    })
  }

  if (reviewing && billing.live) {
    const line = (c: PlanChange, more: boolean) => (
      <SettingsRow
        key={c.kind}
        icon={more ? <ArrowUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <ArrowDown className="h-4 w-4" />}
        title={
          <>
            {nameOf(c.kind)}: <span className="tabular-nums">{c.to.toLocaleString()}</span>
          </>
        }
        detail={`${more ? 'Up' : 'Down'} from ${c.from.toLocaleString()}`}
      />
    )
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-foreground">Check the change</p>
        {up.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Straight away:</span> you pay the difference for the rest of this month now.
            </p>
            <SettingsList>{up.map((c) => line(c, true))}</SettingsList>
          </div>
        )}
        {down.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">From {billing.periodEnd ? day(billing.periodEnd) : 'your next renewal'}:</span> you keep this
              month's amounts until then, with no refund.
            </p>
            <SettingsList>{down.map((c) => line(c, false))}</SettingsList>
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">New monthly price</dt>
          <dd className="text-foreground tabular-nums">{formatPence(pence, billing.currency)}</dd>
          {billing.monthlyPence !== null && (
            <>
              <dt className="text-muted-foreground">Before this change</dt>
              <dd className="text-foreground tabular-nums">{formatPence(billing.monthlyPence, billing.currency)}</dd>
            </>
          )}
        </dl>
        <SettingsActions>
          <Button onClick={() => onSubmit(plan)} isLoading={busy}>
            Confirm change
          </Button>
          <Button variant="outline" onClick={() => setReviewing(false)} disabled={busy}>
            Back
          </Button>
        </SettingsActions>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4">
        {kinds.map((k) => {
          const shown = plan[k.id]
          return (
            <div key={k.id} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <label htmlFor={`plan-${k.id}`} className="font-medium text-foreground">
                  {k.name}
                </label>
                <span className="font-medium tabular-nums text-foreground">{shown.toLocaleString()}</span>
              </div>
              <input
                id={`plan-${k.id}`}
                type="range"
                min={0}
                max={k.steps.length - 1}
                value={at[k.id]}
                onChange={(e) => move(k.id, Number(e.target.value))}
                disabled={busy}
                className="w-full accent-accent cursor-pointer"
              />
              <p className="text-xs text-muted-foreground">
                {unitPrice(k, billing.currency)}: {k.unit}.
                {k.maxShareOf && ` Up to ${Math.round(k.maxShareOf.share * 100)}% of your ${nameOf(k.maxShareOf.kind).toLowerCase()}.`}
              </p>
            </div>
          )
        })}
      </div>

      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">Per month</span>
        <span className="text-2xl font-semibold tabular-nums text-foreground">{formatPence(pence, billing.currency)}</span>
      </div>
      {underMinimum && (
        <Notice level="error">
          The minimum is {formatPence(minimumPence, billing.currency)} a month. Move a slider up.
        </Notice>
      )}
      {billing.live && (
        <p className="text-xs text-muted-foreground">
          More of anything applies straight away, and you pay the difference for the rest of this month. Less of anything applies from your
          next renewal{billing.periodEnd ? ` on ${day(billing.periodEnd)}` : ''}.
        </p>
      )}
      <SettingsActions>
        {billing.live ? (
          <Button onClick={() => setReviewing(true)} disabled={busy || underMinimum || unchanged}>
            Review change
          </Button>
        ) : (
          <Button onClick={() => onSubmit(plan)} isLoading={busy} disabled={underMinimum}>
            Continue to payment
          </Button>
        )}
      </SettingsActions>
    </div>
  )
}
