// Pipelines and their stages. A copy starts with one, "Sales"; more can be
// added (partnerships, renewals …). Every pipeline has at least one open
// stage and exactly one won and one lost stage, which close a deal.

import { randomUUID } from 'node:crypto'
import type { DbSchema } from '../db'
import type { Pipeline, PipelineStage, StageKind } from '../../features/sales/types'

const DEFAULT_STAGES: Array<[string, number, StageKind]> = [
  ['New lead', 10, 'open'],
  ['Contacted', 20, 'open'],
  ['Meeting booked', 40, 'open'],
  ['Proposal sent', 60, 'open'],
  ['Negotiation', 80, 'open'],
  ['Won', 100, 'won'],
  ['Lost', 0, 'lost'],
]

const stage = (name: string, probability: number, kind: StageKind): PipelineStage => ({ id: randomUUID(), name, probability, kind })

/** The pipelines in order, making the default one on first use. Returns whether one was made. */
export function ensurePipelines(data: DbSchema): boolean {
  if (data.pipelines?.length) return false
  const now = new Date().toISOString()
  data.pipelines = [{ id: randomUUID(), name: 'Sales', stages: DEFAULT_STAGES.map(([n, p, k]) => stage(n, p, k)), position: 0, created_at: now, updated_at: now }]
  return true
}

export function listPipelines(data: DbSchema): Pipeline[] {
  return [...(data.pipelines ?? [])].sort((a, b) => a.position - b.position)
}

export function getPipeline(data: DbSchema, id: string): Pipeline {
  const pipeline = data.pipelines?.find((p) => p.id === id)
  if (!pipeline) throw new Error('Pipeline not found')
  return pipeline
}

export interface PipelineInput {
  name: string
  /** In order. A stage without an id is new; an existing stage left out is removed. */
  stages: Array<{ id?: string; name: string; probability: number; kind: StageKind }>
}

function checkStages(stages: PipelineInput['stages']) {
  const names = stages.map((s) => s.name.trim())
  if (names.some((n) => !n)) throw new Error('Every stage needs a name.')
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new Error('Two stages have the same name.')
  if (!stages.some((s) => s.kind === 'open')) throw new Error('A pipeline needs at least one open stage.')
  if (stages.filter((s) => s.kind === 'won').length !== 1) throw new Error('A pipeline needs exactly one Won stage.')
  if (stages.filter((s) => s.kind === 'lost').length !== 1) throw new Error('A pipeline needs exactly one Lost stage.')
}

/** Open stages first in the order given, then won, then lost: the board's order. */
function ordered(stages: PipelineStage[]): PipelineStage[] {
  const rank = { open: 0, won: 1, lost: 2 }
  return stages.map((s, i) => ({ s, i })).sort((a, b) => rank[a.s.kind] - rank[b.s.kind] || a.i - b.i).map(({ s }) => s)
}

function toStages(input: PipelineInput['stages'], existing: PipelineStage[] = []): PipelineStage[] {
  return ordered(
    input.map((s) => {
      const kept = s.id ? existing.find((e) => e.id === s.id) : undefined
      const probability = s.kind === 'won' ? 100 : s.kind === 'lost' ? 0 : Math.max(0, Math.min(100, Math.round(s.probability)))
      return { id: kept?.id ?? randomUUID(), name: s.name.trim(), probability, kind: s.kind }
    }),
  )
}

export function createPipeline(data: DbSchema, input: PipelineInput): Pipeline {
  if (!input.name.trim()) throw new Error('Name the pipeline.')
  const stages = input.stages.length ? input.stages : DEFAULT_STAGES.map(([name, probability, kind]) => ({ name, probability, kind }))
  checkStages(stages)
  const now = new Date().toISOString()
  const pipelines = (data.pipelines ??= [])
  const pipeline: Pipeline = {
    id: randomUUID(),
    name: input.name.trim(),
    stages: toStages(stages),
    position: Math.max(-1, ...pipelines.map((p) => p.position)) + 1,
    created_at: now,
    updated_at: now,
  }
  pipelines.push(pipeline)
  return pipeline
}

/**
 * Renames the pipeline and replaces its stages. A stage that still has deals
 * can't be removed: they'd have nowhere to be. Deals in a stage whose kind
 * changed follow it (won/lost closes them, open reopens them).
 */
export function updatePipeline(data: DbSchema, id: string, input: PipelineInput): Pipeline {
  const pipeline = getPipeline(data, id)
  if (!input.name.trim()) throw new Error('Name the pipeline.')
  checkStages(input.stages)
  const stages = toStages(input.stages, pipeline.stages)
  const kept = new Set(stages.map((s) => s.id))
  const deals = (data.deals ?? []).filter((d) => d.pipeline_id === id)
  const orphaned = pipeline.stages.filter((s) => !kept.has(s.id) && deals.some((d) => d.stage_id === s.id))
  if (orphaned.length) {
    const s = orphaned[0]
    const n = deals.filter((d) => d.stage_id === s.id).length
    throw new Error(`"${s.name}" still has ${n} deal${n === 1 ? '' : 's'}. Move ${n === 1 ? 'it' : 'them'} to another stage first.`)
  }
  const now = new Date().toISOString()
  for (const d of deals) {
    const kind = stages.find((s) => s.id === d.stage_id)!.kind
    if (d.status !== kind) {
      d.status = kind
      d.closed_at = kind === 'open' ? null : now
      d.updated_at = now
    }
  }
  Object.assign(pipeline, { name: input.name.trim(), stages, updated_at: now })
  return pipeline
}

/** Deletes a pipeline with no deals. The last pipeline can't go. */
export function deletePipeline(data: DbSchema, id: string) {
  getPipeline(data, id)
  if ((data.pipelines ?? []).length <= 1) throw new Error('You need at least one pipeline.')
  const n = (data.deals ?? []).filter((d) => d.pipeline_id === id).length
  if (n) throw new Error(`This pipeline still has ${n} deal${n === 1 ? '' : 's'}. Move or delete ${n === 1 ? 'it' : 'them'} first.`)
  data.pipelines = data.pipelines!.filter((p) => p.id !== id)
}

/** Puts the pipelines in the given order; the first is the default. */
export function reorderPipelines(data: DbSchema, ids: string[]) {
  ;(data.pipelines ?? []).forEach((p) => {
    const i = ids.indexOf(p.id)
    p.position = i === -1 ? ids.length + p.position : i
  })
}
