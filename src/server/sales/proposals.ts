// Proposals: a page for a deal, designed in the email builder and shared as a
// private link (/p/<token>, routes/p/$token.ts). Opening it is recorded, not
// counting the team's own previews or link scanners, and the reader can
// accept it by typing their name. Sending it moves the deal on to the
// pipeline's "Proposal" stage when it's still before it.

import { randomBytes, randomUUID } from 'node:crypto'
import type { DbSchema } from '../db'
import type { Proposal, ProposalSummary } from '../../features/sales/types'
import { logActivity, moveDeal } from './deals'
import { getPipeline } from './pipelines'

const now = () => new Date().toISOString()

/** A later open counts as a return visit (and notifies again) after this long. */
export const RETURN_VISIT_MS = 60 * 60_000

const proposalPath = (token: string) => `/p/${token}`

export function summary(p: Proposal, baseUrl: string): ProposalSummary {
  const { html: _html, token, ...rest } = p
  return { ...rest, url: `${baseUrl}${proposalPath(token)}` }
}

function dealOf(data: DbSchema, dealId: string) {
  const deal = data.deals?.find((d) => d.id === dealId)
  if (!deal) throw new Error('Deal not found')
  return deal
}

export function getProposal(data: DbSchema, id: string): Proposal {
  const p = data.proposals?.find((x) => x.id === id)
  if (!p) throw new Error('Proposal not found')
  return p
}

export function byToken(data: DbSchema, token: string): Proposal | null {
  return (token && data.proposals?.find((p) => p.token === token)) || null
}

/** A deal's proposals, newest first. */
export function listProposals(data: DbSchema, dealId: string): Proposal[] {
  return (data.proposals ?? []).filter((p) => p.deal_id === dealId).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

function checkTitle(title: string): string {
  const t = title.trim()
  if (!t) throw new Error('Give the proposal a title.')
  return t.slice(0, 200)
}

export function createProposal(data: DbSchema, input: { dealId: string; title: string; html: string }, actor: string | null): Proposal {
  dealOf(data, input.dealId)
  const at = now()
  const proposal: Proposal = {
    id: randomUUID(),
    deal_id: input.dealId,
    token: randomBytes(24).toString('base64url'),
    title: checkTitle(input.title),
    html: input.html,
    sent_at: null,
    views: 0,
    first_viewed_at: null,
    last_viewed_at: null,
    bot_views: 0,
    accepted_at: null,
    accepted_by: null,
    created_by: actor,
    created_at: at,
    updated_at: at,
  }
  ;(data.proposals ??= []).push(proposal)
  return proposal
}

export function updateProposal(data: DbSchema, id: string, patch: { title?: string; html?: string }): Proposal {
  const p = getProposal(data, id)
  if (patch.title !== undefined) p.title = checkTitle(patch.title)
  if (patch.html !== undefined) p.html = patch.html
  p.updated_at = now()
  return p
}

export function deleteProposal(data: DbSchema, id: string) {
  getProposal(data, id)
  data.proposals = data.proposals!.filter((p) => p.id !== id)
}

/**
 * Marks it sent (the first time), and moves its deal on to the pipeline's
 * proposal stage (the first open stage named like "Proposal sent") when the
 * deal is open and before it. Returns that stage's name when it moved.
 */
export function markSent(data: DbSchema, id: string, actor: string | null, how: string): { proposal: Proposal; movedTo: string | null } {
  const p = getProposal(data, id)
  const deal = dealOf(data, p.deal_id)
  p.sent_at ??= now()
  logActivity(data, {
    kind: 'proposal',
    deal_id: deal.id,
    company_id: deal.company_id,
    contact_email: null,
    body: `${how}: ${p.title}`,
    created_by: actor,
  })
  let movedTo: string | null = null
  if (deal.status === 'open') {
    const pipeline = getPipeline(data, deal.pipeline_id)
    const target = pipeline.stages.findIndex((s) => s.kind === 'open' && /proposal/i.test(s.name))
    const current = pipeline.stages.findIndex((s) => s.id === deal.stage_id)
    if (target > current && current >= 0) {
      moveDeal(data, deal.id, { stageId: pipeline.stages[target].id }, actor)
      movedTo = pipeline.stages[target].name
    }
  }
  return { proposal: p, movedTo }
}

export type ViewResult =
  | { counted: false }
  /** `first`: its first open by a person; `returned`: back after RETURN_VISIT_MS. */
  | { counted: true; first: boolean; returned: boolean; proposal: Proposal; dealName: string }

/**
 * Records an open of the link. The team's own previews aren't recorded;
 * scanners and link previewers only as bot_views. A person's first open is
 * logged on the deal.
 */
export function recordView(data: DbSchema, token: string, by: { automated: boolean; team: boolean }, at = new Date()): ViewResult {
  const p = byToken(data, token)
  if (!p || by.team) return { counted: false }
  if (by.automated) {
    p.bot_views += 1
    return { counted: false }
  }
  const iso = at.toISOString()
  const first = p.views === 0
  const returned = !first && !!p.last_viewed_at && at.getTime() - Date.parse(p.last_viewed_at) >= RETURN_VISIT_MS
  p.views += 1
  p.first_viewed_at ??= iso
  p.last_viewed_at = iso
  const deal = dealOf(data, p.deal_id)
  if (first) {
    logActivity(data, { kind: 'proposal', deal_id: deal.id, company_id: deal.company_id, contact_email: null, body: `Opened: ${p.title}`, created_by: null })
  }
  return { counted: true, first, returned, proposal: p, dealName: deal.name }
}

/** Accepts it in the reader's name. Accepting again changes nothing. */
export function acceptProposal(data: DbSchema, token: string, name: string): { proposal: Proposal; dealName: string; already: boolean } | null {
  const p = byToken(data, token)
  if (!p) return null
  const deal = dealOf(data, p.deal_id)
  if (p.accepted_at) return { proposal: p, dealName: deal.name, already: true }
  const who = name.trim().slice(0, 200)
  if (!who) throw new Error('Type your name to accept.')
  p.accepted_at = now()
  p.accepted_by = who
  logActivity(data, { kind: 'proposal', deal_id: deal.id, company_id: deal.company_id, contact_email: null, body: `Accepted by ${who}: ${p.title}`, created_by: null })
  return { proposal: p, dealName: deal.name, already: false }
}
