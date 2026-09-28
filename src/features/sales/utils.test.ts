import { describe, expect, it } from 'vitest'
import type { DealView, Pipeline } from './types'
import { applyMove, indexAmongAll, inStage, penceToPounds, poundsToPence } from './utils'

const pipeline: Pipeline = {
  id: 'p',
  name: 'New business',
  position: 0,
  created_at: '',
  updated_at: '',
  stages: [
    { id: 'a', name: 'Lead', probability: 10, kind: 'open' },
    { id: 'b', name: 'Proposal', probability: 50, kind: 'open' },
    { id: 'won', name: 'Won', probability: 100, kind: 'won' },
    { id: 'lost', name: 'Lost', probability: 0, kind: 'lost' },
  ],
}

const deal = (id: string, stage_id: string, position: number): DealView => ({
  id,
  name: id,
  pipeline_id: 'p',
  stage_id,
  value: 1000,
  currency: 'GBP',
  company_id: null,
  contact_emails: [],
  owner: null,
  expected_close: null,
  status: 'open',
  lost_reason: null,
  position,
  stage_entered_at: '2026-01-01T00:00:00.000Z',
  closed_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  stage_name: '',
  pipeline_name: 'New business',
  company_name: null,
  contacts: [],
})

const ids = (deals: DealView[], stage: string) => inStage(deals, stage).map((d) => d.id)

describe('applyMove', () => {
  const deals = [deal('d1', 'a', 0), deal('d2', 'a', 1), deal('d3', 'a', 2), deal('e1', 'b', 0)]

  it('reorders within a column', () => {
    expect(ids(applyMove(deals, 'd1', pipeline, pipeline.stages[0]!, 2), 'a')).toEqual(['d2', 'd3', 'd1'])
  })

  it('moves across columns and closes the gap it left', () => {
    const next = applyMove(deals, 'd2', pipeline, pipeline.stages[1]!, 1)
    expect(ids(next, 'a')).toEqual(['d1', 'd3'])
    expect(inStage(next, 'a').map((d) => d.position)).toEqual([0, 1])
    expect(ids(next, 'b')).toEqual(['e1', 'd2'])
    expect(next.find((d) => d.id === 'd2')).toMatchObject({ stage_name: 'Proposal', status: 'open' })
  })

  it('closes a deal moved to Lost, keeping the reason', () => {
    const next = applyMove(deals, 'd1', pipeline, pipeline.stages[3]!, 0, 'Too expensive')
    expect(next.find((d) => d.id === 'd1')).toMatchObject({ status: 'lost', lost_reason: 'Too expensive' })
    expect(next.find((d) => d.id === 'd1')!.closed_at).not.toBeNull()
  })
})

describe('indexAmongAll', () => {
  // All of the stage: x1 h1 x2 h2 (h = hidden by a filter); the board shows x1 x2 and the dropped deal.
  const all = ['x1', 'h1', 'x2', 'h2']
  it('goes before the shown card that follows it', () => {
    expect(indexAmongAll('d', ['x1', 'd', 'x2'], all)).toBe(2)
    expect(indexAmongAll('d', ['d', 'x1', 'x2'], all)).toBe(0)
  })
  it('goes after the last shown card when dropped at the end', () => {
    expect(indexAmongAll('d', ['x1', 'x2', 'd'], all)).toBe(3)
  })
  it('ignores the deal itself when it was already in the stage', () => {
    expect(indexAmongAll('x1', ['x2', 'x1'], all)).toBe(2)
  })
})

describe('pounds and pence', () => {
  it('parses what people type', () => {
    expect(poundsToPence('1,250.50')).toBe(125050)
    expect(poundsToPence('£99')).toBe(9900)
    expect(poundsToPence('')).toBe(0)
    expect(poundsToPence('abc')).toBeNull()
    expect(poundsToPence('-5')).toBeNull()
  })
  it('formats for an input', () => {
    expect(penceToPounds(125000)).toBe('1250')
    expect(penceToPounds(125050)).toBe('1250.50')
  })
})
