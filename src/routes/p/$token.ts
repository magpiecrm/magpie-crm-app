import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../server/db'
import { sales } from '../../server/sales'
import { looksAutomated } from '../../server/clickFilter'
import { notify } from '../../server/notify'
import { notFoundPage, PAGE_HEADERS, proposalPage } from '../../server/proposalPage'
import type { Proposal } from '../../features/sales/types'

// A proposal's private link: the page itself (GET), and accepting it (POST).
// Public: whoever has the link can read and accept it.

/** Whether the request comes from someone signed in to this workspace (a preview, not counted). */
function fromTeam(request: Request): boolean {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)auth_token=([^;]+)/)?.[1]
  if (!token) return false
  const session = db.findSession(decodeURIComponent(token))
  return !!session && new Date(session.expiresAt) > new Date()
}

function page(p: Proposal, request: Request, error?: string | null, status = 200): Response {
  const deal = db.data.deals?.find((d) => d.id === p.deal_id)
  const email = deal?.contact_emails[0]
  const contact = email ? db.getContact(email) : null
  const html = proposalPage(p, {
    reader: contact ? { first_name: contact.first_name, last_name: contact.last_name, company: contact.company, email: contact.email } : null,
    color: db.getBrandKit()?.primaryColor,
    preview: fromTeam(request),
    error,
  })
  return new Response(html, { status, headers: PAGE_HEADERS })
}

const notFound = () => new Response(notFoundPage(), { status: 404, headers: PAGE_HEADERS })

export const Route = createFileRoute('/p/$token')({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { token: string } }) => {
        const view = sales.recordProposalView(params.token, {
          automated: looksAutomated(request.headers.get('user-agent')),
          team: fromTeam(request),
        })
        if (view.counted && (view.first || view.returned)) {
          const what = view.first ? 'was opened' : 'was opened again'
          notify('proposal_viewed', `${view.proposal.title} ${what} (${view.dealName})`, { url: `/sales/deals/${view.proposal.deal_id}` })
        }
        const p = sales.proposalByToken(params.token)
        return p ? page(p, request) : notFound()
      },
      POST: async ({ request, params }: { request: Request; params: { token: string } }) => {
        const p = sales.proposalByToken(params.token)
        if (!p) return notFound()
        const form = await request.formData().catch(() => null)
        const name = String(form?.get('name') ?? '')
        let result: ReturnType<typeof sales.acceptProposal>
        try {
          result = sales.acceptProposal(params.token, name)
        } catch (err) {
          return page(p, request, (err as Error).message, 400)
        }
        if (result && !result.already && !fromTeam(request)) {
          notify('proposal_accepted', `${result.proposal.title} was accepted by ${result.proposal.accepted_by} (${result.dealName})`, {
            url: `/sales/deals/${result.proposal.deal_id}`,
          })
        }
        // Back to the page, so a refresh doesn't post again.
        return new Response(null, { status: 303, headers: { Location: new URL(request.url).pathname } })
      },
    },
  },
})
