// Small helpers for the pipeline board, the deals list and the deal page.

import type { DealStatus, DealView, Pipeline, PipelineStage } from './types'

/** Today as YYYY-MM-DD, in the viewer's time zone (how close dates are stored). */
function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "12 Oct", or "12 Oct 2027" outside this year, from YYYY-MM-DD. */
export function formatCloseDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })
}

/** "3 Mar 2026" from an ISO timestamp. */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** An open deal whose expected close date has passed. */
export function isOverdue(deal: Pick<DealView, 'status' | 'expected_close'>): boolean {
  return deal.status === 'open' && !!deal.expected_close && deal.expected_close < todayISO()
}

/** Whole days since an ISO timestamp. */
export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000))
}

/** "Today", "1 day", "12 days". */
export function formatDays(days: number): string {
  if (days === 0) return 'Today'
  return days === 1 ? '1 day' : `${days} days`
}

/** Deals sitting in one stage longer than this are flagged. */
export const STALE_DAYS = 14

/** "1250.5" or "£1,250.50" → 125050 pence; empty → 0; nonsense → null. */
export function poundsToPence(raw: string): number | null {
  const cleaned = raw.replace(/[£,\s]/g, '')
  if (!cleaned) return 0
  const pounds = Number(cleaned)
  if (!Number.isFinite(pounds) || pounds < 0) return null
  return Math.round(pounds * 100)
}

/** 125050 → "1250.50", 125000 → "1250", for an input box. */
export function penceToPounds(pence: number): string {
  return pence % 100 === 0 ? String(pence / 100) : (pence / 100).toFixed(2)
}

/** "peleg.greenall@x.com" → "Peleg Greenall", for avatars. */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(' ') || email
}

export const openStages = (p: Pipeline) => p.stages.filter((s) => s.kind === 'open')
export const closedStage = (p: Pipeline, kind: 'won' | 'lost') => p.stages.find((s) => s.kind === kind)

export const STATUS_LABEL: Record<DealStatus, string> = { open: 'Open', won: 'Won', lost: 'Lost' }
export const STATUS_BADGE: Record<DealStatus, 'info' | 'success' | 'error'> = { open: 'info', won: 'success', lost: 'error' }

export const sumValue = (deals: Array<Pick<DealView, 'value'>>) => deals.reduce((n, d) => n + d.value, 0)

/** Deals of one stage, in board order. */
export function inStage(deals: DealView[], stageId: string): DealView[] {
  return deals.filter((d) => d.stage_id === stageId).sort((a, b) => a.position - b.position)
}

/**
 * Where a dropped deal goes among *all* the deals in its new stage, when the
 * board only shows some of them (owner or search filters): just before the
 * shown card that now follows it, or just after the one before it.
 */
export function indexAmongAll(dealId: string, shownOrder: string[], allInStage: string[]): number {
  const all = allInStage.filter((id) => id !== dealId)
  const at = shownOrder.indexOf(dealId)
  const next = shownOrder[at + 1]
  if (next && all.includes(next)) return all.indexOf(next)
  const prev = at > 0 ? shownOrder[at - 1] : undefined
  if (prev && all.includes(prev)) return all.indexOf(prev) + 1
  return 0
}

/**
 * What the server does in moveDeal, applied to a cached list so the board
 * updates before the server answers: the deal goes to `stage` at `index`
 * (among that stage's other deals) and both columns are renumbered.
 */
export function applyMove(
  deals: DealView[],
  id: string,
  pipeline: Pipeline,
  stage: PipelineStage,
  index: number,
  lostReason?: string | null,
): DealView[] {
  const deal = deals.find((d) => d.id === id)
  if (!deal) return deals
  const at = new Date().toISOString()
  const changed = deal.stage_id !== stage.id || deal.pipeline_id !== pipeline.id
  const moved: DealView = changed
    ? {
        ...deal,
        pipeline_id: pipeline.id,
        pipeline_name: pipeline.name,
        stage_id: stage.id,
        stage_name: stage.name,
        status: stage.kind,
        stage_entered_at: at,
        closed_at: stage.kind === 'open' ? null : deal.status === stage.kind ? deal.closed_at : at,
        lost_reason: stage.kind === 'lost' ? (lostReason ?? deal.lost_reason) : null,
        updated_at: at,
      }
    : { ...deal }
  const column = deals
    .filter((d) => d.id !== id && d.pipeline_id === moved.pipeline_id && d.stage_id === moved.stage_id)
    .sort((a, b) => a.position - b.position)
  column.splice(Math.max(0, Math.min(index, column.length)), 0, moved)
  const positions = new Map(column.map((d, i) => [d.id, i]))
  // The column it left closes its gap.
  const left = changed
    ? deals.filter((d) => d.id !== id && d.pipeline_id === deal.pipeline_id && d.stage_id === deal.stage_id).sort((a, b) => a.position - b.position)
    : []
  left.forEach((d, i) => positions.set(d.id, i))
  return deals.map((d) => {
    const base = d.id === id ? moved : d
    const position = positions.get(d.id)
    return position === undefined || position === base.position ? base : { ...base, position }
  })
}
