import { createServerFn } from '@tanstack/react-start'

/** This month's usage counts and, when the host sets one, this period's allowance. */
export const getUsageFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  await requireAuth()
  const { monthOf, usageForMonth } = await import('../usage')
  const { allowanceItems, getAllowance } = await import('../allowance')
  const { env } = await import('../env')
  const month = monthOf(new Date())
  const a = getAllowance()
  // Billed by the host: plans are changed in Settings rather than on the host's site.
  const billingManaged = Boolean(env.managedBillingUrl())
  const allowance = a && {
    periodEnd: a.periodEnd,
    upgradeUrl: billingManaged ? '/settings?tab=billing' : a.upgradeUrl,
    sendingPaused: Boolean(a.sendingPaused),
    /** Prospect credits each email reveal uses, when reveals draw on them. */
    revealCredits: a.revealCredits ?? null,
    items: allowanceItems(a),
  }
  return { month, ...usageForMonth(month), allowance, billingManaged }
})
