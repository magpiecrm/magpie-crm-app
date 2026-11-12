import type { Condition, ConditionOp, PageTarget, SurveyBlock, SurveyDesign } from '../types'
import { isQuestionType } from '../types'

/** How each operator reads in a sentence, after the question ("Q1 is at most 6"). */
export const OP_LABELS: Record<ConditionOp, string> = {
  answered: 'is answered',
  not_answered: 'is not answered',
  eq: 'is',
  neq: 'is not',
  includes: 'includes',
  not_includes: 'does not include',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
}

/** Each question's number in the survey (Q1, Q2…), the way the builder and results count them. */
export function questionNumbers(design: SurveyDesign): Map<string, { n: number; block: SurveyBlock }> {
  const out = new Map<string, { n: number; block: SurveyBlock }>()
  let n = 0
  for (const p of design.pages) for (const b of p.blocks) if (isQuestionType(b.type)) out.set(b.id, { n: ++n, block: b })
  return out
}

/** Where a page leads, in words: "2. What went wrong", "the next page", "the end". */
export function describeTarget(design: SurveyDesign, target: PageTarget | undefined, fromIndex: number): string {
  if (!target || target.kind === 'next') return fromIndex >= design.pages.length - 1 ? 'the end' : `${fromIndex + 2}. ${design.pages[fromIndex + 1].title || `Page ${fromIndex + 2}`}`
  if (target.kind === 'end') return 'the end'
  const i = design.pages.findIndex(p => p.id === target.pageId)
  return i < 0 ? 'a deleted page' : `${i + 1}. ${design.pages[i].title || `Page ${i + 1}`}`
}

function describeValue(block: SurveyBlock | undefined, value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  const option = block?.question?.options?.find(o => o.id === value)
  if (option) return `“${option.label}”`
  return String(value)
}

/** A condition as a short phrase: "Q1 is at most 6", "Q3 includes “Support”", or both joined with and/or. */
export function describeCondition(design: SurveyDesign, c: Condition): string {
  if ('all' in c) return c.all.map(x => describeCondition(design, x)).join(' and ')
  if ('any' in c) return c.any.map(x => describeCondition(design, x)).join(' or ')
  const q = questionNumbers(design).get(c.questionId)
  const who = q ? `Q${q.n}` : 'a deleted question'
  const value = c.op === 'answered' || c.op === 'not_answered' ? '' : ` ${describeValue(q?.block, c.value)}`
  return `${who} ${OP_LABELS[c.op]}${value}`
}

/**
 * A page's routes, as lines a person can read, in parts so the builder can
 * make each destination a link to that page: one per rule ("If Q1 is at most
 * 6, go to" + "2. What went wrong"), then where everyone else goes. Empty when
 * the page simply carries on to the next one.
 */
export function describePageRouteParts(design: SurveyDesign, pageIndex: number): Array<{ lead: string; target: string; pageId: string | null }> {
  const page = design.pages[pageIndex]
  const rules = page.rules ?? []
  const custom = !!page.defaultNext && page.defaultNext.kind !== 'next'
  if (!rules.length && !custom) return []
  const pageOf = (t: PageTarget | undefined) => {
    if (!t || t.kind === 'next') return design.pages[pageIndex + 1]?.id ?? null
    return t.kind === 'page' ? t.pageId : null
  }
  return [
    ...rules.map(r => ({ lead: `If ${describeCondition(design, r.when)}, go to`, target: describeTarget(design, r.goTo, pageIndex), pageId: pageOf(r.goTo) })),
    { lead: rules.length ? 'Everyone else goes to' : 'Then go to', target: describeTarget(design, page.defaultNext, pageIndex), pageId: pageOf(page.defaultNext) },
  ]
}
