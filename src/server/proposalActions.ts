// What the app's proposal endpoints (functions/proposals.ts) and the copilot's
// proposal tools (copilot/tools/sales.ts) both do: start a proposal's design,
// share its link, and email it.

import { db } from './db'
import { getAppUrl } from './appUrl'
import { sales } from './sales'
import { summary } from './sales/proposals'
import { proposalEmail } from './proposalPage'
import { formatMoney, type Proposal } from '../features/sales/types'

export type ProposalStart = 'layout' | 'blank' | 'template'

/** A new proposal for a deal, starting from the proposal layout (filled in from the deal), a saved template, or blank. */
export async function startProposal(
  input: { dealId: string; title: string; start: ProposalStart; templateId?: string },
  actor: string | null,
): Promise<Proposal> {
  let html = ''
  if (input.start === 'template') {
    if (!input.templateId) throw new Error('Choose a template.')
    const { getTemplateOrThrow } = await import('./emailTemplates')
    html = getTemplateOrThrow(input.templateId).html
  } else if (input.start === 'layout') {
    const { proposalHtml } = await import('../features/sales/proposalLayout')
    const { deal } = sales.getDeal(input.dealId)
    const first = deal.contacts[0]
    html = proposalHtml({
      title: input.title,
      client: deal.company_name ?? deal.name,
      firstName: first ? db.getContact(first.email)?.first_name || null : null,
      price: deal.value > 0 ? formatMoney(deal.value, deal.currency) : null,
      brand: db.getBrandKit(),
    })
  }
  return sales.createProposal({ dealId: input.dealId, title: input.title, html }, actor)
}

/** Its link, for sending yourself. The first time, that marks it sent (and moves the deal on). */
export async function shareProposal(id: string, actor: string | null): Promise<{ url: string; movedTo: string | null }> {
  const baseUrl = await getAppUrl()
  if (sales.getProposal(id).sent_at) return { url: summary(sales.getProposal(id), baseUrl).url, movedTo: null }
  const { proposal, movedTo } = sales.markProposalSent(id, actor, 'Link shared')
  return { url: summary(proposal, baseUrl).url, movedTo }
}

/** Emails its link from the default sender, skipping anyone unsubscribed or bounced, and marks it sent. */
export async function sendProposal(
  input: { id: string; to: string[]; subject: string; message: string },
  actor: string | null,
): Promise<{ sent: string[]; skipped: Array<{ email: string; why: string }>; movedTo: string | null }> {
  const { sendMail } = await import('./nodemailer')
  const p = sales.getProposal(input.id)
  const url = summary(p, await getAppUrl()).url
  const html = proposalEmail(input.message, url, p.title, db.getBrandKit()?.primaryColor)
  const sent: string[] = []
  const skipped: Array<{ email: string; why: string }> = []
  for (const to of [...new Set(input.to.map((e) => e.toLowerCase().trim()))]) {
    const status = db.getContact(to)?.status
    const stop = db.emailStop(to)
    if ((status && status !== 'subscribed') || stop) {
      skipped.push({ email: to, why: stop?.reason === 'bounced' || status === 'bounced' ? 'their address bounced' : 'they unsubscribed' })
      continue
    }
    await sendMail({ to, subject: input.subject, html })
    sent.push(to)
  }
  const movedTo = sent.length ? sales.markProposalSent(input.id, actor, `Emailed to ${sent.join(', ')}`).movedTo : null
  return { sent, skipped, movedTo }
}
