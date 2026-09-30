import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// Proposals for deals (server/sales/proposals.ts), shared as links (routes/p/$token.ts).

const id = z.string().trim().min(1).max(100)
const title = z.string().trim().min(1).max(200)
/** A compiled design; generous, since images are links rather than embedded. */
const html = z.string().max(2_000_000)

async function signedIn() {
  const { requireAuth } = await import('../auth.server')
  const session = await requireAuth()
  const { sales } = await import('../sales')
  const { getAppUrl } = await import('../appUrl')
  return { sales, actor: session.email as string, baseUrl: await getAppUrl() }
}

export const proposalsFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { dealId: string }) => z.object({ dealId: id }).parse(d))
  .handler(async ({ data }) => {
    const { sales, baseUrl } = await signedIn()
    return sales.listProposals(data.dealId, baseUrl)
  })

/** One proposal with its design, for the editor. */
export const proposalFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sales, baseUrl } = await signedIn()
    const { summary } = await import('../sales/proposals')
    const p = sales.getProposal(data.id)
    return { ...summary(p, baseUrl), html: p.html, deal_name: sales.getDeal(p.deal_id).deal.name }
  })

/** A new proposal, from the proposal layout (filled in from the deal), a saved template, or blank. */
export const createProposalFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { dealId: string; title: string; start: 'layout' | 'blank' | 'template'; templateId?: string }) =>
    z.object({ dealId: id, title, start: z.enum(['layout', 'blank', 'template']), templateId: id.optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { actor } = await signedIn()
    const { startProposal } = await import('../proposalActions')
    return startProposal(data, actor)
  })

export const updateProposalFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; title?: string; html?: string }) => z.object({ id, title: title.optional(), html: html.optional() }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    const { id: proposalId, ...patch } = data
    sales.updateProposal(proposalId, patch)
    return { success: true }
  })

export const deleteProposalFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    sales.deleteProposal(data.id)
    return { success: true }
  })

/** Its link, to send yourself. The first time, that marks it sent (and moves the deal on). */
export const shareProposalFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { actor } = await signedIn()
    const { shareProposal } = await import('../proposalActions')
    return shareProposal(data.id, actor)
  })

/** Emails its link to some of the deal's people, from the default sender, and marks it sent. */
export const sendProposalFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; to: string[]; subject: string; message: string }) =>
    z
      .object({
        id,
        to: z.array(z.string().trim().toLowerCase().email().max(320)).min(1).max(10),
        subject: z.string().trim().min(1).max(300),
        message: z.string().max(10_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { actor } = await signedIn()
    const { sendProposal } = await import('../proposalActions')
    return sendProposal(data, actor)
  })
