import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// Inbox warmup, where the host offers it (server/inboxWarmup.ts).

async function signedIn() {
  const { requireAuth } = await import('../auth.server')
  const session = await requireAuth()
  return { session, warmup: await import('../inboxWarmup') }
}

const address = z.object({ address: z.string().trim().toLowerCase().email().max(320) })

export const inboxWarmupFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { warmup } = await signedIn()
  return warmup.warmupPage()
})

/** Starts a sender's warmup; `agreed` is the person signed in agreeing to the warmup terms shown. */
export const startWarmupFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { senderId: number; agreed: boolean; version: string }) =>
    z.object({ senderId: z.number().int(), agreed: z.literal(true), version: z.string().max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { session, warmup } = await signedIn()
    if (data.version !== warmup.CONSENT_VERSION) throw new Error('The warmup terms have changed: read them again, then switch it on.')
    return warmup.startWarmup(data.senderId, session.email)
  })

export const pauseWarmupFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { address: string }) => address.parse(d))
  .handler(async ({ data }) => (await signedIn()).warmup.pauseWarmup(data.address))

export const resumeWarmupFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { address: string }) => address.parse(d))
  .handler(async ({ data }) => (await signedIn()).warmup.resumeWarmup(data.address))

export const stopWarmupFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { address: string }) => address.parse(d))
  .handler(async ({ data }) => {
    await (await signedIn()).warmup.stopWarmup(data.address)
    return { success: true }
  })

export const warmupHistoryFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { address: string; days?: number }) => address.extend({ days: z.number().int().min(1).max(90).default(30) }).parse(d))
  .handler(async ({ data }) => (await signedIn()).warmup.warmupHistory(data.address, data.days))

export const warmupPlacementFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { days?: number }) => z.object({ days: z.number().int().min(1).max(90).default(7) }).parse(d))
  .handler(async ({ data }) => (await signedIn()).warmup.warmupPlacement(data.days))

/** Whether placement tests are offered here, and each warming sender's standing by address. */
export const warmupStandingFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { warmup } = await signedIn()
  return { offered: warmup.warmupOffered(), senders: await warmup.warmupStanding() }
})

export const startPlacementTestFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { sender: { name: string; email: string }; subject: string; htmlContent: string; previewText?: string }) =>
    z
      .object({
        sender: z.object({ name: z.string().max(200), email: z.string().trim().email().max(320) }),
        subject: z.string().trim().min(1).max(300),
        htmlContent: z.string().min(1).max(500_000),
        previewText: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => (await signedIn()).warmup.startPlacementTest(data))

export const placementTestFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => (await signedIn()).warmup.placementTestResult(data.id))
