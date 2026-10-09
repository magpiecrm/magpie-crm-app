import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CreditCard, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { billingPortalFn, cancelPlanFn, changePlanFn, checkoutFn, finishCheckoutFn, getBillingFn, keepPlanFn } from '../../../server/functions'
import type { Plan } from '../../../server/managedBilling'
import { formatPence } from '../planMath'
import { AllowanceMeter } from './AllowanceMeter'
import { PlanEditor } from './PlanEditor'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsOption, SettingsPanel } from './SettingsBlock'

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
      <div className="flex flex-col gap-4">
        <SettingsPanel>
          <SettingsBlock title="Your plan">
            <SettingsEmpty>
              <RefreshCw className="mr-2 inline h-4 w-4 animate-spin text-accent" />
              {finishing ? 'Setting up your plan…' : 'Loading your plan…'}
            </SettingsEmpty>
          </SettingsBlock>
        </SettingsPanel>
      </div>
    )
  }
  if (billing.isError || !billing.data) {
    return (
      <div className="flex flex-col gap-4">
        <Notice level="error">{billing.error ? (billing.error as Error).message : "Billing isn't available on this workspace."}</Notice>
      </div>
    )
  }

  const b = billing.data
  const busy = change.isPending || keep.isPending || cancel.isPending
  const failed = (change.error ?? keep.error ?? (finishError ? new Error(finishError) : null)) as Error | null

  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice level="success">{notice}</Notice>}
      {failed && <Notice level="error">{failed.message}</Notice>}

      {b.status === 'past_due' && (
        <Notice
          level="error"
          title="Your last payment didn't go through"
          action={
            <Button size="sm" variant="outline" onClick={() => portal.mutate(window.open('', '_blank'))} isLoading={portal.isPending}>
              Update card
            </Button>
          }
        >
          The payment provider is retrying it. Update your card so your plan carries on.
        </Notice>
      )}
      {b.live && b.cancelAt && (
        <Notice
          level="warning"
          title={`Your plan ends on ${day(b.cancelAt)}`}
          action={
            <Button size="sm" onClick={() => keep.mutate()} isLoading={keep.isPending}>
              Keep my plan
            </Button>
          }
        >
          You keep everything until then. After that there's nothing to search, reveal or send with, and 30 days later the workspace closes (your data is kept).
        </Notice>
      )}
      {!b.live && b.endedAt && (
        <Notice level="error" title={`Your plan ended on ${day(b.endedAt)}`}>
          You can still sign in and see your data, but not search, reveal or send.
          {b.suspendOn && ` The workspace closes on ${day(b.suspendOn)} (${daysUntil(b.suspendOn)} days) unless you choose a plan; your data is kept.`}
        </Notice>
      )}

      <SettingsPanel>
        {b.live && (
          <SettingsBlock
            title="Your plan"
            description={`What you've used of your plan.${b.periodEnd ? ` It resets on ${day(b.periodEnd)}; unused amounts don't roll over.` : ''}`}
          >
            {b.monthlyPence !== null && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Price</dt>
                <dd className="text-foreground tabular-nums">{formatPence(b.monthlyPence, b.currency)} a month</dd>
                {b.periodEnd && !b.cancelAt && (
                  <>
                    <dt className="text-muted-foreground">Renews</dt>
                    <dd className="text-foreground tabular-nums">{day(b.periodEnd)}</dd>
                  </>
                )}
              </dl>
            )}
            <AllowanceMeter showUpgrade={false} heading={false} />
          </SettingsBlock>
        )}

        <SettingsBlock
          title={b.live ? 'Change your plan' : 'Choose a plan'}
          description={
            b.live
              ? "Pick how much you'll use each month. You're charged for more straight away; less applies from your next renewal."
              : "Pick how much you'll use each month, then pay in the secure checkout. You pay monthly up front, and can cancel any time."
          }
        >
          {b.live && b.cancelAt ? (
            <Notice>Keep your plan first to change it.</Notice>
          ) : (
            <PlanEditor key={JSON.stringify(b.nextPlan)} billing={b} busy={change.isPending} onSubmit={(plan) => change.mutate(plan)} />
          )}
        </SettingsBlock>

        {b.status !== 'none' && (
          <SettingsBlock title="Payment method and invoices" description="Your card, billing details and past invoices, on the payment provider's secure page.">
            {portal.isError && <Notice level="error">{(portal.error as Error).message}</Notice>}
            <SettingsActions>
              <Button
                variant="outline"
                leftIcon={<CreditCard className="h-4 w-4" />}
                rightIcon={<ExternalLink className="h-3.5 w-3.5" />}
                onClick={() => portal.mutate(window.open('', '_blank'))}
                isLoading={portal.isPending}
              >
                Manage payment and invoices
              </Button>
            </SettingsActions>
          </SettingsBlock>
        )}

        {b.live && !b.cancelAt && (
          <SettingsBlock title="Cancel your plan" description="Your plan ends at the end of the month you've paid for. You can change your mind until then.">
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
              <SettingsActions>
                <Button
                  variant="outline"
                  className="!border-destructive/40 !text-destructive hover:!bg-destructive/10"
                  onClick={() => setCancelling(true)}
                  disabled={busy}
                >
                  Cancel plan
                </Button>
              </SettingsActions>
            )}
          </SettingsBlock>
        )}
      </SettingsPanel>
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
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onCancel({ feedback, comment: comment.trim() })
      }}
    >
      <Notice level="warning" title="Cancel your plan?">
        It ends {endsOn ? `on ${day(endsOn)}` : 'at the end of this month'}, with no refund for the rest of the month. After that there's nothing to search,
        reveal or send with, and 30 days later the workspace closes. Your data is kept, and choosing a plan again opens it.
      </Notice>
      <div role="radiogroup" aria-labelledby="cancel-why" className="flex flex-col gap-1.5">
        <span id="cancel-why" className="text-xs font-semibold text-muted-foreground">
          Why are you leaving? (optional)
        </span>
        <FieldGrid>
          {reasons.map((r) => (
            <SettingsOption key={r.id} selected={feedback === r.id} onSelect={() => setFeedback(r.id)} title={r.label} />
          ))}
        </FieldGrid>
      </div>
      <Field label="Anything else you'd like to tell us? (optional)">
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={3} className={INPUT_CLASS} />
      </Field>
      {error && <Notice level="error">{error}</Notice>}
      <SettingsActions>
        <Button type="submit" variant="danger" isLoading={busy}>
          Cancel my plan
        </Button>
        <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
          Keep it
        </Button>
      </SettingsActions>
    </form>
  )
}
