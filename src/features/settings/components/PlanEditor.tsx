import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Notice } from '../../../components/ui/Notice'
import type { BillingStatus, Plan, PlanAddon } from '../../../server/managedBilling'
import { addonPrice, capped, formatPence, isAddon, isBudget, kindAmount, monthlyPence, nearestStep, planChanges, unitPrice, type PlanChange } from '../planMath'
import { SettingsActions, SettingsCheck, SettingsList, SettingsRow } from './SettingsBlock'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })

/**
 * Sliders for each kind the host sells, a tick box for each add-on, the
 * monthly total, and a review step that says what changes when before
 * anything is charged.
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
  const { kinds, addons, minimumPence } = billing.catalogue
  const current = billing.live ? billing.nextPlan : null
  // A first plan starts where the website's pricing does.
  const start: Plan = current ?? { prospects: 1250, reveals: 250, emails: 5000 }
  const [at, setAt] = useState<Record<string, number>>(() =>
    Object.fromEntries(kinds.map((k) => [k.id, nearestStep(k.steps, start[k.id] ?? 0)])),
  )
  // Only the add-ons the host lists are sent: one it doesn't keeps what the plan has.
  const [ticked, setTicked] = useState<Partial<Record<PlanAddon, 0 | 1>>>(() =>
    Object.fromEntries(addons.map((a) => [a.id, start[a.id] === 1 ? 1 : 0])),
  )
  const [reviewing, setReviewing] = useState(false)

  const planAt = (positions: Record<string, number>) => {
    // An AI budget the host doesn't list is left out, so the plan keeps what it has.
    const raw: Plan = { prospects: 0, reveals: 0, emails: 0 }
    for (const k of kinds) raw[k.id] = k.steps[positions[k.id]] ?? 0
    return capped(raw, kinds)
  }
  const plan: Plan = useMemo(() => ({ ...planAt(at), ...ticked }), [at, kinds, ticked])
  const pence = monthlyPence(plan, kinds, addons)
  const underMinimum = pence < minimumPence
  const { up, down } = planChanges(current, plan)
  const unchanged = billing.live && up.length === 0 && down.length === 0
  const nameOf = (id: string) => [...kinds, ...addons].find((k) => k.id === id)?.name ?? id
  const amountOf = (id: string, n: number) => {
    const kind = kinds.find((k) => k.id === id)
    return kind ? kindAmount(kind, n, billing.currency) : n.toLocaleString()
  }

  // Moving one slider can pull another down with it (reveals follow prospects).
  const move = (id: string, i: number) => {
    setReviewing(false)
    setAt((prev) => {
      const next = { ...prev, [id]: i }
      const fitted = planAt(next)
      for (const k of kinds) next[k.id] = nearestStep(k.steps, fitted[k.id] ?? 0)
      return next
    })
  }
  const tick = (id: PlanAddon, on: boolean) => {
    setReviewing(false)
    setTicked((prev) => ({ ...prev, [id]: on ? 1 : 0 }))
  }

  if (reviewing && billing.live) {
    const line = (c: PlanChange, more: boolean) => (
      <SettingsRow
        key={c.kind}
        icon={more ? <ArrowUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <ArrowDown className="h-4 w-4" />}
        title={
          isAddon(c.kind) ? (
            nameOf(c.kind)
          ) : (
            <>
              {nameOf(c.kind)}: <span className="tabular-nums">{amountOf(c.kind, c.to)}</span>
            </>
          )
        }
        detail={isAddon(c.kind) ? (more ? 'Added' : 'Removed') : `${more ? 'Up' : 'Down'} from ${amountOf(c.kind, c.from)}`}
      />
    )
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-foreground">Check the change</p>
        {up.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground">Straight away:</span> you pay the difference for the rest of this month now.
            </p>
            <SettingsList>{up.map((c) => line(c, true))}</SettingsList>
          </div>
        )}
        {down.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground">From {billing.periodEnd ? day(billing.periodEnd) : 'your next renewal'}:</span> you keep this
              month's plan until then, with no refund.
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
          const shown = plan[k.id] ?? 0
          return (
            <div key={k.id} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <label htmlFor={`plan-${k.id}`} className="font-medium text-foreground">
                  {k.name}
                </label>
                <span className="font-medium tabular-nums text-foreground">{kindAmount(k, shown, billing.currency)}</span>
              </div>
              <input
                id={`plan-${k.id}`}
                type="range"
                min={0}
                max={k.steps.length - 1}
                value={at[k.id]}
                onChange={(e) => move(k.id, Number(e.target.value))}
                disabled={busy}
                style={{ '--pct': `${k.steps.length > 1 ? (at[k.id] / (k.steps.length - 1)) * 100 : 0}%` } as CSSProperties}
                className="range-input w-full cursor-pointer"
              />
              <p className="text-[13px] text-muted-foreground">
                {/* A budget is its own price: say what it's for, not a unit price. */}
                {isBudget(k.id)
                  ? 'For the copilot, which uses it as it works. Settings → Copilot shows how much of it is used'
                  : `${unitPrice(k, billing.currency)}: ${k.unit}`}
                .
                {k.maxShareOf && ` Up to ${Math.round(k.maxShareOf.share * 100)}% of your ${nameOf(k.maxShareOf.kind).toLowerCase()}.`}
              </p>
            </div>
          )
        })}
        {addons.map((a) => {
          // One that can't be added now can still be kept by a plan that has it.
          const closed = !a.available && billing.plan?.[a.id] !== 1 && current?.[a.id] !== 1
          return (
            <SettingsCheck
              key={a.id}
              checked={plan[a.id] === 1}
              onChange={(on) => tick(a.id, on)}
              disabled={busy || closed}
              label={<span className="font-medium">{a.name}</span>}
              hint={
                <>
                  {addonPrice(a, billing.currency)}: {a.unit}.{closed && ` ${a.note ?? "It can't be added right now."}`}
                </>
              }
            />
          )
        })}
      </div>

      <div className="flex flex-col">
        <span className="text-[13px] text-muted-foreground">Per month</span>
        <span className="text-2xl font-semibold tabular-nums text-foreground">{formatPence(pence, billing.currency)}</span>
      </div>
      {underMinimum && (
        <Notice level="error">
          The minimum is {formatPence(minimumPence, billing.currency)} a month. Move a slider up.
        </Notice>
      )}
      {billing.live && (
        <p className="text-[13px] text-muted-foreground">
          More of anything{addons.length > 0 ? ', or an add-on ticked,' : ''} applies straight away, and you pay the difference for the rest of this
          month. Less of anything{addons.length > 0 ? ', or an add-on unticked,' : ''} applies from your next renewal
          {billing.periodEnd ? ` on ${day(billing.periodEnd)}` : ''}.
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
