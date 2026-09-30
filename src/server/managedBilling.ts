// This copy's plan, when whoever hosts it bills for it (MANAGED_BILLING_URL):
// Settings → Plan and billing shows it and changes or cancels it through the
// host, which charges through its payment provider. The host describes what
// it sells (the catalogue), so nothing here knows any prices.
//
// Requests go server to server with this copy's USAGE_API_TOKEN; the browser
// never sees the token. The only addresses passed back to the browser are the
// payment provider's own pages (Stripe Checkout and its billing page).

import { env } from './env'

export type PlanKind = 'prospects' | 'reveals' | 'emails'
export type Plan = Record<PlanKind, number>

export interface CatalogueKind {
  id: PlanKind
  name: string
  /** What one unit is, e.g. "work email found and verified". */
  unit: string
  /** Priced per this many units (emails: per 1,000). */
  per: number
  /** The amounts that can be chosen, smallest first. */
  steps: number[]
  /** Price per unit, in thousandths of a penny. */
  unitMillipence: number
  /** At most this share of another kind (reveals: 30% of prospect credits). */
  maxShareOf?: { kind: PlanKind; share: number }
}

export interface BillingStatus {
  managed: true
  /** The payment provider's status: active, past_due, canceled…, or "none" before a first plan. */
  status: string
  /** They have what they paid for (active, trialing or past_due). */
  live: boolean
  /** This period's allowances (a downgrade keeps what was paid for until renewal). */
  plan: Plan | null
  /** What renews. */
  nextPlan: Plan | null
  monthlyPence: number | null
  currency: string
  periodStart: string | null
  periodEnd: string | null
  /** A pending cancellation: the plan ends then. */
  cancelAt: string | null
  cancelFeedback: string | null
  /** The plan ended (no allowances until a new one)… */
  endedAt: string | null
  /** …and the workspace closes then, unless they choose one. */
  suspendOn: string | null
  catalogue: {
    minimumPence: number
    cancelReasons: Array<{ id: string; label: string }>
    kinds: CatalogueKind[]
  }
}

/** A change the host refused or couldn't make, with words for the person. */
export class BillingFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const MESSAGES: Record<string, string> = {
  card_declined: 'Your card was declined, so nothing changed. Update it under Payment method and invoices, then try again.',
  cancel_pending: 'Your plan is set to end. Choose Keep my plan first, then change it.',
  not_live: 'Choose a plan to continue.',
  ended: 'Your plan has ended. Choose a new one to continue.',
  live: 'You already have a plan: change it instead.',
  already_cancelling: 'Your plan is already set to end.',
  not_cancelling: "Your plan isn't set to end.",
  no_customer: 'There are no payment details yet: choose a plan first.',
  too_many: 'Too many changes at once. Try again in a minute.',
}
const UNAVAILABLE = "Billing isn't available right now. Try again in a few minutes."

type Fetch = (url: string, init: RequestInit) => Promise<Response>
export interface ManagedBillingDeps {
  fetch?: Fetch
  base?: string
  token?: string
}

/** Stripe's own pages only: anything else from the host isn't passed on to the browser. */
export function isPaymentPage(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'checkout.stripe.com' || u.hostname === 'billing.stripe.com')
  } catch {
    return false
  }
}

/** One request to the host; throws BillingFailure with a message to show. */
export async function hostBilling<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  opts: { idempotencyKey?: string } = {},
  deps: ManagedBillingDeps = {},
): Promise<T> {
  const base = deps.base ?? env.managedBillingUrl()
  const token = deps.token ?? env.usageApiToken()
  if (!base || !token) throw new BillingFailure('unavailable', "Billing isn't set up on this workspace.")
  let res: Response
  try {
    res = await (deps.fetch ?? fetch)(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      // Changes wait on the payment provider; the host allows it about 20 seconds.
      signal: AbortSignal.timeout(method === 'GET' ? 10_000 : 30_000),
    })
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new BillingFailure('timeout', "We couldn't confirm the change. Refresh in a minute to see your plan.")
    }
    throw new BillingFailure('unavailable', UNAVAILABLE)
  }
  const json: any = await res.json().catch(() => null)
  if (!res.ok) {
    const code = typeof json?.error === 'string' ? json.error : `http_${res.status}`
    // The host's own words for a plan it can't sell (e.g. under the minimum).
    const message = code === 'invalid_plan' && typeof json?.message === 'string' ? json.message : (MESSAGES[code] ?? UNAVAILABLE)
    throw new BillingFailure(code, message)
  }
  return json as T
}

/** The host's answer, if it's this workspace's plan (a host that stopped billing answers 404 managed:false). */
export async function getBilling(deps: ManagedBillingDeps = {}): Promise<BillingStatus | null> {
  try {
    const status = await hostBilling<BillingStatus>('GET', '', undefined, {}, deps)
    return status?.managed === true ? status : null
  } catch (err) {
    if (err instanceof BillingFailure && err.code === 'http_404') return null
    throw err
  }
}

/** A payment page's address from the host, or a failure if it isn't one. */
export function paymentPage(json: { url?: unknown }): string {
  if (!isPaymentPage(json?.url)) throw new BillingFailure('unavailable', UNAVAILABLE)
  return json.url
}
