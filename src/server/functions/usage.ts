import { createServerFn } from '@tanstack/react-start'

/** This month's usage counts and, when the host sets one, this period's allowance. */
export const getUsageFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  await requireAuth()
  const { monthOf, usageForMonth } = await import('../usage')
  const { ALLOWANCE_KINDS, getAllowance } = await import('../allowance')
  const { env } = await import('../env')
  const month = monthOf(new Date())
  const a = getAllowance()
  // Billed by the host: plans are changed in Settings rather than on the host's site.
  const billingManaged = Boolean(env.managedBillingUrl())
  const allowance = a && {
    periodEnd: a.periodEnd,
    upgradeUrl: billingManaged ? '/settings?tab=billing' : a.upgradeUrl,
    sendingPaused: Boolean(a.sendingPaused),
    // Prospect credits are counted to the hundredth; shown whole.
    items: ALLOWANCE_KINDS.flatMap((kind) => (a.limits[kind] === undefined ? [] : [{ kind, used: Math.round(a.used[kind]), limit: a.limits[kind]! }])),
  }
  return { month, ...usageForMonth(month), allowance, billingManaged }
})
