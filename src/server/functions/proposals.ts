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
    const { sales, actor } = await signedIn()
    let body = ''
    if (data.start === 'template') {
      if (!data.templateId) throw new Error('Choose a template.')
      const { getTemplateOrThrow } = await import('../emailTemplates')
      body = getTemplateOrThrow(data.templateId).html
    } else if (data.start === 'layout') {
      const { db } = await import('../db')
      const { proposalHtml } = await import('../../features/sales/proposalLayout')
      const { formatMoney } = await import('../../features/sales/types')
      const { deal } = sales.getDeal(data.dealId)
      const first = deal.contacts[0]
      const firstName = first ? (db.getContact(first.email)?.first_name || null) : null
      body = proposalHtml({
        title: data.title,
        client: deal.company_name ?? deal.name,
        firstName,
        price: deal.value > 0 ? formatMoney(deal.value, deal.currency) : null,
        brand: db.getBrandKit(),
      })
    }
    return sales.createProposal({ dealId: data.dealId, title: data.title, html: body }, actor)
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
    const { sales, actor, baseUrl } = await signedIn()
    const { summary } = await import('../sales/proposals')
    const already = sales.getProposal(data.id).sent_at
    const { proposal, movedTo } = already ? { proposal: sales.getProposal(data.id), movedTo: null } : sales.markProposalSent(data.id, actor, 'Link shared')
    return { url: summary(proposal, baseUrl).url, movedTo }
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
    const { sales, actor, baseUrl } = await signedIn()
    const { db } = await import('../db')
    const { sendMail } = await import('../nodemailer')
    const { summary } = await import('../sales/proposals')
    const { proposalEmail } = await import('../proposalPage')
    const p = sales.getProposal(data.id)
    const url = summary(p, baseUrl).url
    const html = proposalEmail(data.message, url, p.title, db.getBrandKit()?.primaryColor)
    const sent: string[] = []
    const skipped: Array<{ email: string; why: string }> = []
    for (const to of [...new Set(data.to)]) {
      // Not to someone who unsubscribed, complained or whose address bounced.
      const status = db.getContact(to)?.status
      const stop = db.emailStop(to)
      if ((status && status !== 'subscribed') || stop) {
        skipped.push({ email: to, why: stop?.reason === 'bounced' || status === 'bounced' ? 'their address bounced' : 'they unsubscribed' })
        continue
      }
      await sendMail({ to, subject: data.subject, html })
      sent.push(to)
    }
    const movedTo = sent.length ? sales.markProposalSent(data.id, actor, `Emailed to ${sent.join(', ')}`).movedTo : null
    return { sent, skipped, movedTo }
  })
