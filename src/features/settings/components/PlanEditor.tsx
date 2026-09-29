import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import type { BillingStatus, Plan } from '../../../server/managedBilling'
import { capped, formatPence, monthlyPence, nearestStep, planChanges, unitPrice, PLAN_KINDS } from '../planMath'

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
    return (
      <div className="flex flex-col gap-4 max-w-xl">
        <div className="rounded-md-m border border-border bg-card p-4 flex flex-col gap-3">
          <h4 className="text-sm font-semibold text-foreground">Check the change</h4>
          {up.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Straight away:</span> you pay the difference for the rest of this month now.
              </p>
              {up.map((c) => (
                <p key={c.kind} className="flex items-center gap-2 text-sm text-foreground">
                  <ArrowUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  {nameOf(c.kind)}: {c.from.toLocaleString()} → <b>{c.to.toLocaleString()}</b>
                </p>
              ))}
            </div>
          )}
          {down.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">From {billing.periodEnd ? day(billing.periodEnd) : 'your next renewal'}:</span> you keep this
                month's amounts until then, with no refund.
              </p>
              {down.map((c) => (
                <p key={c.kind} className="flex items-center gap-2 text-sm text-foreground">
                  <ArrowDown className="w-4 h-4 text-muted-foreground" />
                  {nameOf(c.kind)}: {c.from.toLocaleString()} → <b>{c.to.toLocaleString()}</b>
                </p>
              ))}
            </div>
          )}
          <p className="text-sm text-foreground border-t border-border pt-3">
            New monthly price <b className="tabular-nums">{formatPence(pence, billing.currency)}</b>
            {billing.monthlyPence !== null && <span className="text-muted-foreground"> (was {formatPence(billing.monthlyPence, billing.currency)})</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => onSubmit(plan)} isLoading={busy}>
            Confirm change
          </Button>
          <Button variant="outline" onClick={() => setReviewing(false)} disabled={busy}>
            Back
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 max-w-xl">
      {kinds.map((k) => {
        const shown = plan[k.id]
        return (
          <div key={k.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={`plan-${k.id}`} className="text-sm font-semibold text-foreground">
                {k.name}
              </label>
              <span className="text-sm font-semibold tabular-nums text-foreground">{shown.toLocaleString()}</span>
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
            <p className="text-[11px] text-muted-foreground">
              {unitPrice(k, billing.currency)}: {k.unit}.
              {k.maxShareOf && ` Up to ${Math.round(k.maxShareOf.share * 100)}% of your ${nameOf(k.maxShareOf.kind).toLowerCase()}.`}
            </p>
          </div>
        )
      })}

      <div className="flex items-baseline justify-between border-t border-border pt-3">
        <span className="text-sm text-muted-foreground">Per month</span>
        <b className="text-lg tabular-nums text-foreground">{formatPence(pence, billing.currency)}</b>
      </div>
      {underMinimum && (
        <p className="text-xs text-destructive" role="alert">
          The minimum is {formatPence(minimumPence, billing.currency)} a month. Move a slider up.
        </p>
      )}
      {billing.live && (
        <p className="text-xs text-muted-foreground">
          More of anything applies straight away, and you pay the difference for the rest of this month. Less of anything applies from your
          next renewal{billing.periodEnd ? ` on ${day(billing.periodEnd)}` : ''}.
        </p>
      )}
      <div>
        {billing.live ? (
          <Button onClick={() => setReviewing(true)} disabled={busy || underMinimum || unchanged}>
            Review change
          </Button>
        ) : (
          <Button onClick={() => onSubmit(plan)} isLoading={busy} disabled={underMinimum}>
            Continue to payment
          </Button>
        )}
      </div>
    </div>
  )
}
