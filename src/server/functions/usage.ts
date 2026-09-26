import { createServerFn } from '@tanstack/react-start'

/** This month's usage counts, for the Settings overview. */
export const getUsageFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  await requireAuth()
  const { monthOf, usageForMonth } = await import('../usage')
  const month = monthOf(new Date())
  return { month, ...usageForMonth(month) }
})
