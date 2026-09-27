import { createServerFn } from '@tanstack/react-start'

/** This month's usage counts and, when the host sets one, this period's allowance. */
export const getUsageFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  await requireAuth()
  const { monthOf, usageForMonth } = await import('../usage')
  const { ALLOWANCE_KINDS, getAllowance } = await import('../allowance')
  const month = monthOf(new Date())
  const a = getAllowance()
  const allowance = a && {
    periodEnd: a.periodEnd,
    upgradeUrl: a.upgradeUrl,
    sendingPaused: Boolean(a.sendingPaused),
    items: ALLOWANCE_KINDS.flatMap((kind) => (a.limits[kind] === undefined ? [] : [{ kind, used: a.used[kind], limit: a.limits[kind]! }])),
  }
  return { month, ...usageForMonth(month), allowance }
})
