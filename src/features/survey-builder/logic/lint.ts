import type { ContactFieldDef } from '../../contacts/contactFields'
import type { Condition, PageTarget, SurveyDesign, SurveySettings } from '../types'
import { CHOICE_TYPES, isQuestionType } from '../types'
import { compatibleFieldTypes } from './answers'

export interface LintIssue {
  level: 'error' | 'warning'
  message: string
  pageId?: string
  blockId?: string
}

function conditionQuestionIds(c: Condition): string[] {
  if ('all' in c) return c.all.flatMap(conditionQuestionIds)
  if ('any' in c) return c.any.flatMap(conditionQuestionIds)
  return [c.questionId]
}

/**
 * Structural checks run by the builder's logic badge, by `publishSurvey`
 * (errors block publishing) and by the copilot's `lintSurvey` tool.
 */
export function lintSurvey(
  design: SurveyDesign,
  settings?: Pick<SurveySettings, 'identifyContacts'>,
  contactFields: ContactFieldDef[] = [],
): LintIssue[] {
  const issues: LintIssue[] = []
  const pageIndex = new Map(design.pages.map((p, i) => [p.id, i]))
  const questionPage = new Map<string, number>()
  design.pages.forEach((p, i) =>
    p.blocks.forEach(b => {
      if (isQuestionType(b.type)) questionPage.set(b.id, i)
    }),
  )

  if (design.pages.length === 0) issues.push({ level: 'error', message: 'The survey has no pages.' })
  if (questionPage.size === 0) issues.push({ level: 'error', message: 'The survey has no questions.' })

  const checkTarget = (target: PageTarget | undefined, fromIndex: number, pageId: string, what: string) => {
    if (!target || target.kind !== 'page') return
    const to = pageIndex.get(target.pageId)
    if (to === undefined) issues.push({ level: 'error', pageId, message: `${what} jumps to a page that no longer exists.` })
    else if (to <= fromIndex) issues.push({ level: 'error', pageId, message: `${what} jumps backwards; jumps must go to a later page.` })
  }

  const reachable = new Set<string>()
  if (design.pages[0]) reachable.add(design.pages[0].id)

  design.pages.forEach((page, i) => {
    const label = page.title || `Page ${i + 1}`
    page.rules?.forEach((rule, r) => {
      const what = `${label}, rule ${r + 1},`
      checkTarget(rule.goTo, i, page.id, what)
      for (const qid of conditionQuestionIds(rule.when)) {
        const qPage = questionPage.get(qid)
        if (qPage === undefined) issues.push({ level: 'error', pageId: page.id, message: `${what} refers to a question that no longer exists.` })
        else if (qPage > i) issues.push({ level: 'error', pageId: page.id, message: `${what} refers to a question on a later page.` })
      }
      if (rule.goTo.kind === 'page') reachable.add(rule.goTo.pageId)
    })
    checkTarget(page.defaultNext, i, page.id, `${label}'s default next step`)

    const fallthrough = !page.defaultNext || page.defaultNext.kind === 'next'
    if (fallthrough && design.pages[i + 1]) reachable.add(design.pages[i + 1].id)
    if (page.defaultNext?.kind === 'page') reachable.add(page.defaultNext.pageId)

    for (const block of page.blocks) {
      const q = block.question
      if (!isQuestionType(block.type) || !q) continue
      if (!q.title.trim()) issues.push({ level: 'warning', pageId: page.id, blockId: block.id, message: `A question on ${label} has no title.` })
      if (CHOICE_TYPES.includes(block.type) && (q.options?.length ?? 0) < 2 && !q.allowOther) {
        issues.push({ level: 'error', pageId: page.id, blockId: block.id, message: `"${q.title || 'Untitled'}" needs at least two options.` })
      }
      if (q.mapTo?.field.startsWith('custom:')) {
        const key = q.mapTo.field.slice('custom:'.length)
        const def = contactFields.find(f => f.key === key)
        if (!def) issues.push({ level: 'error', pageId: page.id, blockId: block.id, message: `"${q.title}" maps to a contact field that no longer exists.` })
        else if (!compatibleFieldTypes(block).includes(def.type)) {
          issues.push({ level: 'warning', pageId: page.id, blockId: block.id, message: `"${q.title}" (${block.type}) maps to ${def.type} field "${def.label}"; some answers won't be saved.` })
        }
      }
    }
  })

  design.pages.forEach((page, i) => {
    if (!reachable.has(page.id)) {
      issues.push({ level: 'warning', pageId: page.id, message: `${page.title || `Page ${i + 1}`} can never be reached.` })
    }
  })

  const hasEmailQuestion = design.pages.some(p => p.blocks.some(b => b.type === 'email'))
  if (settings?.identifyContacts && !hasEmailQuestion) {
    issues.push({
      level: 'warning',
      message: 'Identify contacts is on but there is no Email question, so only respondents from email links will be matched to contacts.',
    })
  }

  return issues
}
