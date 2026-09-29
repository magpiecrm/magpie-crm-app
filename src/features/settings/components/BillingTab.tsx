import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, AlertTriangle, CheckCircle2, CreditCard, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { queryKeys } from '../../../queryKeys'
import { billingPortalFn, cancelPlanFn, changePlanFn, checkoutFn, finishCheckoutFn, getBillingFn, keepPlanFn } from '../../../server/functions'
import type { Plan } from '../../../server/managedBilling'
import { formatPence } from '../planMath'
import { AllowanceMeter } from './AllowanceMeter'
import { PlanEditor } from './PlanEditor'
import { SettingsBlock } from './SettingsBlock'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
/** Checkout sessions already recorded, so a remount doesn't record one twice. */
const finishedSessions = new Set<string>()
const daysUntil = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))

type Outcome = { success: true } | { success: false; error: string }
/** The server functions answer { success, error }; a failure becomes a thrown message for the mutation. */
const orThrow = <T extends Outcome>(r: T) => {
  if (!r.success) throw new Error(r.error)
  return r as Extract<T, { success: true }>
}

/**
 * Settings → Plan and billing, when the host bills for this workspace: the
 * plan and this month's use of it, changing it, the card and invoices, and
 * cancelling (at the end of the paid month, undoable until then).
 */
export function BillingTab({ checkoutSession }: { checkoutSession?: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const billing = useQuery({ queryKey: queryKeys.settings.billing(), queryFn: () => getBillingFn() })
  const [notice, setNotice] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.billing() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.usage() })
  }

  // Back from paying: record the new plan now rather than waiting on the host to hear from Stripe.
  const [finishing, setFinishing] = useState(Boolean(checkoutSession))
  const [finishError, setFinishError] = useState<string | null>(null)
  useEffect(() => {
    if (!checkoutSession) return
    if (finishedSessions.has(checkoutSession)) return setFinishing(false)
    finishedSessions.add(checkoutSession)
    finishCheckoutFn({ data: { sessionId: checkoutSession } })
      .then((r) => (r.success ? setNotice('Thanks: your plan is live.') : setFinishError(r.error)))
      .catch(() => setFinishError("We couldn't confirm your payment yet. Refresh in a minute to see your plan."))
      .finally(() => {
        setFinishing(false)
        refresh()
        void navigate({ to: '/settings', search: { tab: 'billing' }, replace: true })
      })
  }, [checkoutSession])

  const change = useMutation({
    mutationFn: async (plan: Plan) => {
      if (billing.data?.live) return orThrow(await changePlanFn({ data: { plan } }))
      // No plan yet (or it ended): pay in Stripe Checkout, which comes back here.
      const r = orThrow(await checkoutFn({ data: { plan } }))
      window.location.assign(r.url)
      return null
    },
    onSuccess: (r) => {
      if (!r) return
      setNotice(
        r.changed === 'up' ? 'Done: your new amounts apply now.' : r.changed === 'down' ? 'Done: your plan gets smaller at your next renewal.' : r.changed === 'both' ? 'Done: increases apply now, decreases at your next renewal.' : null,
      )
      refresh()
    },
  })
  const keep = useMutation({
    mutationFn: () => keepPlanFn().then(orThrow),
    onSuccess: () => {
      setNotice("Your plan continues: it'll renew as usual.")
      refresh()
    },
  })
  const cancel = useMutation({
    mutationFn: (why: { feedback: string | null; comment: string }) => cancelPlanFn({ data: why }).then(orThrow),
    onSuccess: () => {
      setCancelling(false)
      setNotice(null)
      refresh()
    },
  })
  const portal = useMutation({
    // The tab is opened on the click itself, so pop-up blockers allow it; the address follows.
    mutationFn: async (tab: Window | null) => {
      const r = await billingPortalFn()
      if (!r.success) {
        tab?.close()
        throw new Error(r.error)
      }
      if (tab) tab.location.href = r.url
      else window.location.assign(r.url)
    },
  })

  if (billing.isLoading || finishing) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> {finishing ? 'Setting up your plan…' : 'Loading your plan…'}
      </p>
    )
  }
  if (billing.isError || !billing.data) {
    return (
      <p className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="w-4 h-4" />
        {billing.error ? (billing.error as Error).message : "Billing isn't available on this workspace."}
      </p>
    )
  }

  const b = billing.data
  const busy = change.isPending || keep.isPending || cancel.isPending
  const failed = (change.error ?? keep.error ?? (finishError ? new Error(finishError) : null)) as Error | null

  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400" role="status">
          <CheckCircle2 className="w-4 h-4" /> {notice}
        </p>
      )}
      {failed && (
        <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
          <AlertCircle className="w-4 h-4" /> {failed.message}
        </p>
      )}

      {b.status === 'past_due' && (
        <Banner tone="error" title="Your last payment didn't go through">
          <p>The payment provider is retrying it. Update your card so your plan carries on.</p>
          <Button size="sm" variant="secondary" onClick={() => portal.mutate(window.open('', '_blank'))} isLoading={portal.isPending}>
            Update card
          </Button>
        </Banner>
      )}
      {b.live && b.cancelAt && (
        <Banner tone="warning" title={`Your plan ends on ${day(b.cancelAt)}`}>
          <p>You keep everything until then. After that there's nothing to search, reveal or send with, and 30 days later the workspace closes (your data is kept).</p>
          <Button size="sm" onClick={() => keep.mutate()} isLoading={keep.isPending}>
            Keep my plan
          </Button>
        </Banner>
      )}
      {!b.live && b.endedAt && (
        <Banner tone="error" title={`Your plan ended on ${day(b.endedAt)}`}>
          <p>
            You can still sign in and see your data, but not search, reveal or send.
            {b.suspendOn && ` The workspace closes on ${day(b.suspendOn)} (${daysUntil(b.suspendOn)} days) unless you choose a plan; your data is kept.`}
          </p>
        </Banner>
      )}

      {b.live && (
        <SettingsBlock
          title="This month"
          description={
            <>
              <p>What you've used of your plan.{b.periodEnd && ` It resets on ${day(b.periodEnd)}; unused amounts don't roll over.`}</p>
              {b.monthlyPence !== null && (
                <p>
                  <span className="font-semibold text-foreground">{formatPence(b.monthlyPence, b.currency)} a month</span>
                  {b.periodEnd && !b.cancelAt && `, renews ${day(b.periodEnd)}`}
                </p>
              )}
            </>
          }
        >
          <AllowanceMeter showUpgrade={false} />
        </SettingsBlock>
      )}

      <SettingsBlock
        title={b.live ? 'Change your plan' : 'Choose a plan'}
        description={
          b.live ? (
            <p>Pick how much you'll use each month. You're charged for more straight away; less applies from your next renewal.</p>
          ) : (
            <p>Pick how much you'll use each month, then pay in the secure checkout. You pay monthly up front, and can cancel any time.</p>
          )
        }
      >
        {b.live && b.cancelAt ? (
          <p className="text-sm text-muted-foreground">Keep your plan first to change it.</p>
        ) : (
          <PlanEditor key={JSON.stringify(b.nextPlan)} billing={b} busy={change.isPending} onSubmit={(plan) => change.mutate(plan)} />
        )}
      </SettingsBlock>

      {b.status !== 'none' && (
        <SettingsBlock title="Payment method and invoices" description={<p>Your card, billing details and past invoices, on the payment provider's secure page.</p>}>
          <div className="flex flex-col gap-2 items-start">
            <Button variant="secondary" leftIcon={<CreditCard className="w-4 h-4" />} rightIcon={<ExternalLink className="w-3.5 h-3.5" />} onClick={() => portal.mutate(window.open('', '_blank'))} isLoading={portal.isPending}>
              Manage payment and invoices
            </Button>
            {portal.isError && <p className="text-xs text-destructive">{(portal.error as Error).message}</p>}
          </div>
        </SettingsBlock>
      )}

      {b.live && !b.cancelAt && (
        <SettingsBlock title="Cancel your plan" description={<p>Your plan ends at the end of the month you've paid for. You can change your mind until then.</p>}>
          {cancelling ? (
            <CancelForm
              reasons={b.catalogue.cancelReasons}
              endsOn={b.periodEnd}
              busy={cancel.isPending}
              error={cancel.isError ? (cancel.error as Error).message : null}
              onCancel={(why) => cancel.mutate(why)}
              onBack={() => setCancelling(false)}
            />
          ) : (
            <div>
              <Button variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => setCancelling(true)} disabled={busy}>
                Cancel plan…
              </Button>
            </div>
          )}
        </SettingsBlock>
      )}
    </div>
  )
}

function Banner({ tone, title, children }: { tone: 'warning' | 'error'; title: string; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-md-m border p-4 flex gap-3 ${tone === 'error' ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/40 bg-amber-500/5'}`}
      role="status"
    >
      <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${tone === 'error' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`} />
      <div className="flex flex-col gap-2 items-start text-sm text-foreground">
        <p className="font-semibold">{title}</p>
        <div className="flex flex-col gap-3 items-start text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

/** Why they're leaving (optional), and a clear last step before anything changes. */
function CancelForm({
  reasons,
  endsOn,
  busy,
  error,
  onCancel,
  onBack,
}: {
  reasons: Array<{ id: string; label: string }>
  endsOn: string | null
  busy: boolean
  error: string | null
  onCancel: (why: { feedback: string | null; comment: string }) => void
  onBack: () => void
}) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  return (
    <form
      className="rounded-md-m border border-destructive/40 bg-destructive/5 p-4 flex flex-col gap-4 max-w-xl"
      onSubmit={(e) => {
        e.preventDefault()
        onCancel({ feedback, comment: comment.trim() })
      }}
    >
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold text-foreground">Cancel your plan?</h4>
        <p className="text-xs text-muted-foreground">
          It ends {endsOn ? `on ${day(endsOn)}` : 'at the end of this month'}, with no refund for the rest of the month. After that there's nothing to search,
          reveal or send with, and 30 days later the workspace closes. Your data is kept, and choosing a plan again opens it.
        </p>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs font-semibold text-foreground mb-1">Why are you leaving? (optional)</legend>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {reasons.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="radio" name="feedback" value={r.id} checked={feedback === r.id} onChange={() => setFeedback(r.id)} className="accent-accent" />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-foreground">Anything else you'd like to tell us? (optional)</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          rows={3}
          className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      {error && (
        <p className="flex items-center gap-2 text-xs text-destructive" role="alert">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" isLoading={busy}>
          Cancel my plan
        </Button>
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          Keep it
        </Button>
      </div>
    </form>
  )
}
