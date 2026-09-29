import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// Settings → Plan and billing, when the host bills for this copy
// (MANAGED_BILLING_URL, see managedBilling.ts). Changes return
// { success, error } so the section can show the host's reason.

const amount = z.number().int().min(0).max(100_000_000)
const plan = z.object({ prospects: amount, reveals: amount, emails: amount })

async function signedIn() {
  const { requireAuth } = await import('../auth.server')
  const session = await requireAuth()
  return session.email as string
}

type Outcome<T> = ({ success: true } & T) | { success: false; error: string }

/** Runs a change, turning the host's refusal into words to show. */
async function change<T>(fn: () => Promise<T>): Promise<Outcome<T>> {
  const { BillingFailure } = await import('../managedBilling')
  try {
    return { success: true, ...(await fn()) }
  } catch (err) {
    if (err instanceof BillingFailure) return { success: false, error: err.message }
    console.error('[billing]', err)
    return { success: false, error: "Billing isn't available right now. Try again in a few minutes." }
  }
}

/** Their plan, or null when this copy isn't billed by its host. */
export const getBillingFn = createServerFn({ method: 'GET' }).handler(async () => {
  await signedIn()
  const { env } = await import('../env')
  if (!env.managedBillingUrl()) return null
  const { getBilling } = await import('../managedBilling')
  return getBilling()
})

export const changePlanFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { plan: z.input<typeof plan> }) => z.object({ plan }).parse(d))
  .handler(async ({ data }) => {
    const actor = await signedIn()
    const { hostBilling } = await import('../managedBilling')
    return change(() =>
      hostBilling<{ changed: 'up' | 'down' | 'both' | 'none' }>('POST', '/plan', { plan: data.plan, actor }, { idempotencyKey: crypto.randomUUID() }).then((r) => ({ changed: r.changed })),
    )
  })

export const cancelPlanFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { feedback?: string | null; comment?: string | null }) =>
    z.object({ feedback: z.string().max(40).nullable().optional(), comment: z.string().trim().max(500).nullable().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const actor = await signedIn()
    const { hostBilling } = await import('../managedBilling')
    return change(() => hostBilling('POST', '/cancel', { feedback: data.feedback ?? null, comment: data.comment || null, actor }).then(() => ({})))
  })

export const keepPlanFn = createServerFn({ method: 'POST' }).handler(async () => {
  const actor = await signedIn()
  const { hostBilling } = await import('../managedBilling')
  return change(() => hostBilling('POST', '/resume', { actor }).then(() => ({})))
})

/** Stripe Checkout for a first plan (or a new one after the last ended). */
export const checkoutFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { plan: z.input<typeof plan> }) => z.object({ plan }).parse(d))
  .handler(async ({ data }) => {
    const actor = await signedIn()
    const { hostBilling, paymentPage } = await import('../managedBilling')
    return change(() =>
      hostBilling<{ url?: string }>('POST', '/checkout', { plan: data.plan, actor }, { idempotencyKey: crypto.randomUUID() }).then((r) => ({ url: paymentPage(r) })),
    )
  })

/** Back from Checkout: records the new plan straight away rather than waiting for the host to hear from Stripe. */
export const finishCheckoutFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { sessionId: string }) => z.object({ sessionId: z.string().regex(/^cs_[A-Za-z0-9_]{1,200}$/) }).parse(d))
  .handler(async ({ data }) => {
    await signedIn()
    const { hostBilling } = await import('../managedBilling')
    return change(() => hostBilling('POST', '/checkout/finish', { sessionId: data.sessionId }).then(() => ({})))
  })

/** Stripe's billing page, for their card and invoices. */
export const billingPortalFn = createServerFn({ method: 'POST' }).handler(async () => {
  const actor = await signedIn()
  const { hostBilling, paymentPage } = await import('../managedBilling')
  return change(() => hostBilling<{ url?: string }>('POST', '/portal-session', { actor }).then((r) => ({ url: paymentPage(r) })))
})
