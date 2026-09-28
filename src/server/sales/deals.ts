// Deals and their activity (notes, stage changes). A deal sits in one stage
// of one pipeline; its status follows the stage's kind, so moving it to the
// Won or Lost stage closes it and moving it back reopens it.

import { randomUUID } from 'node:crypto'
import type { DbSchema } from '../db'
import type { Activity, Deal, DealView } from '../../features/sales/types'
import { getPipeline, listPipelines } from './pipelines'

const now = () => new Date().toISOString()
const normEmail = (e: string) => e.toLowerCase().trim()

function contactName(data: DbSchema, email: string): string | null {
  const c = data.contacts.find((x) => x.email === email)
  const name = [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim()
  return name || null
}

/** A deal with the names the pages show. Contacts deleted since are left out. */
function dealView(data: DbSchema, deal: Deal): DealView {
  const pipeline = data.pipelines?.find((p) => p.id === deal.pipeline_id)
  const contacts = deal.contact_emails
    .filter((email) => data.contacts.some((c) => c.email === email))
    .map((email) => ({ email, name: contactName(data, email) }))
  return {
    ...deal,
    stage_name: pipeline?.stages.find((s) => s.id === deal.stage_id)?.name ?? '',
    pipeline_name: pipeline?.name ?? '',
    company_name: deal.company_id ? (data.companies?.find((c) => c.id === deal.company_id)?.name ?? null) : null,
    contacts,
  }
}

export interface DealFilters {
  pipelineId?: string
  status?: Deal['status']
  owner?: string
  companyId?: string
  contactEmail?: string
  q?: string
}

export function listDeals(data: DbSchema, f: DealFilters = {}): DealView[] {
  const q = f.q?.trim().toLowerCase()
  return (data.deals ?? [])
    .filter((d) => !f.pipelineId || d.pipeline_id === f.pipelineId)
    .filter((d) => !f.status || d.status === f.status)
    .filter((d) => !f.owner || d.owner === f.owner)
    .filter((d) => !f.companyId || d.company_id === f.companyId)
    .filter((d) => !f.contactEmail || d.contact_emails.includes(normEmail(f.contactEmail)))
    .map((d) => dealView(data, d))
    .filter((d) => !q || [d.name, d.company_name, ...d.contacts.flatMap((c) => [c.email, c.name])].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => a.position - b.position || b.updated_at.localeCompare(a.updated_at))
}

export function getDeal(data: DbSchema, id: string): { deal: DealView; activities: Activity[] } {
  const deal = data.deals?.find((d) => d.id === id)
  if (!deal) throw new Error('Deal not found')
  return { deal: dealView(data, deal), activities: newestFirst((data.activities ?? []).filter((a) => a.deal_id === id)) }
}

export interface DealInput {
  name: string
  pipelineId?: string
  stageId?: string
  /** Minor units (pence). */
  value?: number
  companyId?: string | null
  contactEmails?: string[]
  owner?: string | null
  expectedClose?: string | null
  lostReason?: string | null
}

function checkRefs(data: DbSchema, input: Partial<DealInput>) {
  if (input.companyId && !data.companies?.some((c) => c.id === input.companyId)) throw new Error('Company not found')
  for (const e of input.contactEmails ?? []) {
    if (!data.contacts.some((c) => c.email === normEmail(e))) throw new Error(`${e} isn't a contact.`)
  }
  if (input.owner && !data.users.some((u) => u.email === input.owner)) throw new Error(`${input.owner} isn't a user here.`)
  if (input.value !== undefined && (!Number.isInteger(input.value) || input.value < 0)) throw new Error('The value must be zero or more.')
  if (input.expectedClose && !/^\d{4}-\d{2}-\d{2}$/.test(input.expectedClose)) throw new Error('The close date must be a date.')
}

function logActivity(data: DbSchema, entry: Omit<Activity, 'id' | 'created_at'>): Activity {
  const activity: Activity = { ...entry, id: randomUUID(), created_at: now() }
  ;(data.activities ??= []).push(activity)
  return activity
}

/** Puts the deal at `index` in its stage and renumbers the rest of that stage. */
function placeInStage(data: DbSchema, deal: Deal, index?: number) {
  const others = (data.deals ?? [])
    .filter((d) => d.id !== deal.id && d.pipeline_id === deal.pipeline_id && d.stage_id === deal.stage_id)
    .sort((a, b) => a.position - b.position)
  const at = index === undefined ? 0 : Math.max(0, Math.min(index, others.length))
  others.splice(at, 0, deal)
  others.forEach((d, i) => (d.position = i))
}

export function createDeal(data: DbSchema, input: DealInput, actor: string | null): DealView {
  if (!input.name.trim()) throw new Error('Name the deal.')
  checkRefs(data, input)
  const pipeline = input.pipelineId ? getPipeline(data, input.pipelineId) : listPipelines(data)[0]
  if (!pipeline) throw new Error('Pipeline not found')
  const stage = input.stageId ? pipeline.stages.find((s) => s.id === input.stageId) : pipeline.stages.find((s) => s.kind === 'open')
  if (!stage) throw new Error('Stage not found')
  const at = now()
  const deal: Deal = {
    id: randomUUID(),
    name: input.name.trim(),
    pipeline_id: pipeline.id,
    stage_id: stage.id,
    value: input.value ?? 0,
    currency: 'GBP',
    company_id: input.companyId ?? null,
    contact_emails: [...new Set((input.contactEmails ?? []).map(normEmail))],
    owner: input.owner ?? actor,
    expected_close: input.expectedClose ?? null,
    status: stage.kind,
    lost_reason: stage.kind === 'lost' ? (input.lostReason ?? null) : null,
    position: 0,
    stage_entered_at: at,
    closed_at: stage.kind === 'open' ? null : at,
    created_at: at,
    updated_at: at,
  }
  ;(data.deals ??= []).push(deal)
  placeInStage(data, deal, 0)
  logActivity(data, { kind: 'created', deal_id: deal.id, company_id: deal.company_id, contact_email: null, body: `Created in ${stage.name}`, to_stage: stage.name, created_by: actor })
  return dealView(data, deal)
}

/** Changes a deal's details (not its stage: see moveDeal). */
export function updateDeal(data: DbSchema, id: string, input: Partial<Omit<DealInput, 'pipelineId' | 'stageId'>>): DealView {
  const deal = data.deals?.find((d) => d.id === id)
  if (!deal) throw new Error('Deal not found')
  checkRefs(data, input)
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('Name the deal.')
    deal.name = input.name.trim()
  }
  if (input.value !== undefined) deal.value = input.value
  if (input.companyId !== undefined) deal.company_id = input.companyId
  if (input.contactEmails !== undefined) deal.contact_emails = [...new Set(input.contactEmails.map(normEmail))]
  if (input.owner !== undefined) deal.owner = input.owner
  if (input.expectedClose !== undefined) deal.expected_close = input.expectedClose
  if (input.lostReason !== undefined && deal.status === 'lost') deal.lost_reason = input.lostReason
  deal.updated_at = now()
  return dealView(data, deal)
}

/**
 * Moves a deal to a stage (of its pipeline, or another one), at a place in
 * that stage's column. A stage change is logged; won/lost close the deal.
 */
export function moveDeal(
  data: DbSchema,
  id: string,
  to: { stageId: string; pipelineId?: string; index?: number; lostReason?: string | null },
  actor: string | null,
): DealView {
  const deal = data.deals?.find((d) => d.id === id)
  if (!deal) throw new Error('Deal not found')
  const from = getPipeline(data, deal.pipeline_id)
  const pipeline = to.pipelineId ? getPipeline(data, to.pipelineId) : from
  const stage = pipeline.stages.find((s) => s.id === to.stageId)
  if (!stage) throw new Error('Stage not found')
  const fromStage = from.stages.find((s) => s.id === deal.stage_id)
  const changed = stage.id !== deal.stage_id || pipeline.id !== deal.pipeline_id
  const at = now()
  if (changed) {
    deal.pipeline_id = pipeline.id
    deal.stage_id = stage.id
    deal.stage_entered_at = at
    if (deal.status !== stage.kind) deal.closed_at = stage.kind === 'open' ? null : at
    deal.status = stage.kind
    deal.lost_reason = stage.kind === 'lost' ? (to.lostReason ?? deal.lost_reason) : null
    deal.updated_at = at
    const where = pipeline.id === from.id ? stage.name : `${stage.name} (${pipeline.name})`
    logActivity(data, {
      kind: 'stage_change',
      deal_id: deal.id,
      company_id: deal.company_id,
      contact_email: null,
      body: stage.kind === 'lost' && deal.lost_reason ? `Moved to ${where}: ${deal.lost_reason}` : `Moved to ${where}`,
      from_stage: fromStage?.name,
      to_stage: stage.name,
      created_by: actor,
    })
  } else if (stage.kind === 'lost' && to.lostReason !== undefined) {
    deal.lost_reason = to.lostReason
  }
  placeInStage(data, deal, to.index)
  return dealView(data, deal)
}

export function deleteDeal(data: DbSchema, id: string) {
  if (!data.deals?.some((d) => d.id === id)) throw new Error('Deal not found')
  data.deals = data.deals.filter((d) => d.id !== id)
  data.activities = (data.activities ?? []).filter((a) => a.deal_id !== id)
}

/** A note on a deal, a company or a contact. */
export function addNote(
  data: DbSchema,
  on: { dealId?: string; companyId?: string; contactEmail?: string },
  body: string,
  actor: string | null,
): Activity {
  if (!body.trim()) throw new Error('Write something first.')
  const deal = on.dealId ? data.deals?.find((d) => d.id === on.dealId) : undefined
  if (on.dealId && !deal) throw new Error('Deal not found')
  if (on.companyId && !data.companies?.some((c) => c.id === on.companyId)) throw new Error('Company not found')
  const email = on.contactEmail ? normEmail(on.contactEmail) : null
  if (email && !data.contacts.some((c) => c.email === email)) throw new Error('Contact not found')
  if (!deal && !on.companyId && !email) throw new Error('Say what the note is about.')
  if (deal) deal.updated_at = now()
  return logActivity(data, {
    kind: 'note',
    deal_id: deal?.id ?? null,
    company_id: on.companyId ?? deal?.company_id ?? null,
    contact_email: email,
    body: body.trim(),
    created_by: actor,
  })
}

/** Deletes a note (only notes: stage changes are the deal's history). */
export function deleteNote(data: DbSchema, id: string) {
  const a = data.activities?.find((x) => x.id === id)
  if (!a) throw new Error('Note not found')
  if (a.kind !== 'note') throw new Error('Only notes can be deleted.')
  data.activities = data.activities!.filter((x) => x.id !== id)
}

/** A company's activity: its own notes, and its deals'. Newest first. */
export function companyActivity(data: DbSchema, companyId: string): Activity[] {
  const deals = new Set((data.deals ?? []).filter((d) => d.company_id === companyId).map((d) => d.id))
  return newestFirst((data.activities ?? []).filter((a) => a.company_id === companyId || (a.deal_id && deals.has(a.deal_id))))
}

/** Newest first; things done in the same millisecond keep the order they were written in. */
function newestFirst(activities: Activity[]): Activity[] {
  return activities
    .map((a, i) => ({ a, i }))
    .sort((x, y) => y.a.created_at.localeCompare(x.a.created_at) || y.i - x.i)
    .map(({ a }) => a)
}
