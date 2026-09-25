import type { Condition, LogicRule, PageTarget, SurveyBlock, SurveyDesign, SurveyPage } from './types'
import { isQuestionType } from './types'

/**
 * Survey builder actions are namespaced `survey.*` so the copilot plumbing can
 * route them to the survey builder rather than the email builder, which shares
 * the same client-action channel.
 */
export const SURVEY_ACTION_PREFIX = 'survey.'

export interface SurveyBuilderAction {
  action: string
  args: any
}

function newSurveyId(prefix: string): string {
  return `${prefix}_` + Math.random().toString(36).slice(2, 11)
}

export const newPageId = () => newSurveyId('p')
export const newBlockId = () => newSurveyId('q')
export const newOptionId = () => newSurveyId('o')
export const newRuleId = () => newSurveyId('r')

export function findBlock(design: SurveyDesign, id: string): { page: SurveyPage; block: SurveyBlock; index: number } | undefined {
  for (const page of design.pages) {
    const index = page.blocks.findIndex(b => b.id === id)
    if (index !== -1) return { page, block: page.blocks[index], index }
  }
  return undefined
}

function clampIndex(index: unknown, length: number): number {
  return typeof index === 'number' ? Math.max(0, Math.min(length, index)) : length
}

function mapPages(design: SurveyDesign, fn: (p: SurveyPage) => SurveyPage): SurveyDesign {
  return { ...design, pages: design.pages.map(fn) }
}

function mapBlock(design: SurveyDesign, id: string, fn: (b: SurveyBlock) => SurveyBlock): SurveyDesign {
  return mapPages(design, p =>
    p.blocks.some(b => b.id === id) ? { ...p, blocks: p.blocks.map(b => (b.id === id ? fn(b) : b)) } : p,
  )
}

function conditionMentions(c: Condition, questionId: string): boolean {
  if ('all' in c) return c.all.some(x => conditionMentions(x, questionId))
  if ('any' in c) return c.any.some(x => conditionMentions(x, questionId))
  return c.questionId === questionId
}

/** Drop rules that refer to a deleted question or jump to a deleted page. */
function pruneRules(design: SurveyDesign, removed: { questionId?: string; pageId?: string }): SurveyDesign {
  const pointsAtRemoved = (t: PageTarget | undefined) => t?.kind === 'page' && t.pageId === removed.pageId
  return mapPages(design, p => {
    const rules = p.rules?.filter(
      r => !(removed.questionId && conditionMentions(r.when, removed.questionId)) && !pointsAtRemoved(r.goTo),
    )
    return {
      ...p,
      rules,
      defaultNext: pointsAtRemoved(p.defaultNext) ? undefined : p.defaultNext,
    }
  })
}

/** Fill in the `question` object for question blocks so every consumer can rely on it. */
export function normalizeBlock(block: Partial<SurveyBlock> & { type: SurveyBlock['type'] }): SurveyBlock {
  const b: SurveyBlock = { ...block, id: block.id ?? newBlockId() }
  if (isQuestionType(b.type)) {
    b.question = { title: '', required: false, ...b.question }
    if (['single_choice', 'multiple_choice', 'dropdown'].includes(b.type)) {
      b.question.options = (b.question.options ?? []).map(o => ({ ...o, id: o.id ?? newOptionId() }))
    }
  } else {
    delete b.question
  }
  return b
}

/**
 * Apply one mutation to a survey design.
 *
 * Pure, and shared by both sides like the email builder's `applyBuilderAction`:
 * the browser uses it to update the live canvas, and the copilot server uses it
 * to keep its copy of the design current within a turn.
 */
export function applySurveyBuilderAction(design: SurveyDesign, { action, args }: SurveyBuilderAction): SurveyDesign {
  const name = action.startsWith(SURVEY_ACTION_PREFIX) ? action.slice(SURVEY_ACTION_PREFIX.length) : action

  switch (name) {
    case 'applyTemplate':
      return {
        pages: args.pages ?? [],
        theme: { ...design.theme, ...(args.theme ?? {}) },
      }

    case 'replacePages':
      return { ...design, pages: args.pages ?? [] }

    case 'restoreDesign':
      return { pages: args.pages ?? design.pages, theme: args.theme ?? design.theme }

    case 'setTheme':
      return { ...design, theme: { ...design.theme, ...(args.updates ?? {}) } }

    case 'addPage': {
      const page: SurveyPage = { blocks: [], ...args.page, id: args.page?.id ?? newPageId() }
      page.blocks = page.blocks.map(b => normalizeBlock(b))
      const pages = [...design.pages]
      pages.splice(clampIndex(args.index, pages.length), 0, page)
      return { ...design, pages }
    }

    case 'updatePage':
      return mapPages(design, p => (p.id === args.id ? { ...p, ...args.updates, id: p.id, blocks: p.blocks } : p))

    case 'deletePage': {
      if (design.pages.length <= 1) return design
      const page = design.pages.find(p => p.id === args.id)
      if (!page) return design
      let next: SurveyDesign = { ...design, pages: design.pages.filter(p => p.id !== args.id) }
      next = pruneRules(next, { pageId: args.id })
      for (const b of page.blocks) next = pruneRules(next, { questionId: b.id })
      return next
    }

    case 'movePage': {
      const i = design.pages.findIndex(p => p.id === args.id)
      const target = args.direction === 'up' ? i - 1 : i + 1
      if (i === -1 || target < 0 || target >= design.pages.length) return design
      const pages = [...design.pages]
      ;[pages[i], pages[target]] = [pages[target], pages[i]]
      return { ...design, pages }
    }

    case 'addBlock': {
      const block = normalizeBlock(args.block)
      const pageId = args.pageId ?? design.pages[design.pages.length - 1]?.id
      return mapPages(design, p => {
        if (p.id !== pageId) return p
        const blocks = [...p.blocks]
        blocks.splice(clampIndex(args.index, blocks.length), 0, block)
        return { ...p, blocks }
      })
    }

    case 'updateBlock':
      return mapBlock(design, args.id, b => {
        const updates = args.updates ?? {}
        const next: SurveyBlock = { ...b, ...updates, id: b.id, style: { ...b.style, ...updates.style } }
        if (updates.question || b.question) next.question = { ...b.question!, ...updates.question }
        return normalizeBlock(next)
      })

    case 'deleteBlock': {
      const next = mapPages(design, p => ({ ...p, blocks: p.blocks.filter(b => b.id !== args.id) }))
      return pruneRules(next, { questionId: args.id })
    }

    case 'moveBlock': {
      // Either a step within the page (`direction`) or a move to `toPageId`/`index`.
      const hit = findBlock(design, args.id)
      if (!hit) return design
      if (args.direction) {
        const target = args.direction === 'up' ? hit.index - 1 : hit.index + 1
        if (target < 0 || target >= hit.page.blocks.length) return design
        return mapPages(design, p => {
          if (p.id !== hit.page.id) return p
          const blocks = [...p.blocks]
          ;[blocks[hit.index], blocks[target]] = [blocks[target], blocks[hit.index]]
          return { ...p, blocks }
        })
      }
      const toPageId = args.toPageId ?? hit.page.id
      if (!design.pages.some(p => p.id === toPageId)) return design
      const removed = mapPages(design, p => (p.id === hit.page.id ? { ...p, blocks: p.blocks.filter(b => b.id !== args.id) } : p))
      return mapPages(removed, p => {
        if (p.id !== toPageId) return p
        const blocks = [...p.blocks]
        blocks.splice(clampIndex(args.index, blocks.length), 0, hit.block)
        return { ...p, blocks }
      })
    }

    case 'addOption':
      return mapBlock(design, args.blockId, b => {
        const options = [...(b.question?.options ?? [])]
        options.splice(clampIndex(args.index, options.length), 0, { id: args.option?.id ?? newOptionId(), label: args.option?.label ?? '' })
        return { ...b, question: { ...b.question!, options } }
      })

    case 'updateOption':
      return mapBlock(design, args.blockId, b => ({
        ...b,
        question: {
          ...b.question!,
          options: (b.question?.options ?? []).map(o => (o.id === args.optionId ? { ...o, ...args.updates, id: o.id } : o)),
        },
      }))

    case 'deleteOption':
      return mapBlock(design, args.blockId, b => ({
        ...b,
        question: { ...b.question!, options: (b.question?.options ?? []).filter(o => o.id !== args.optionId) },
      }))

    case 'moveOption':
      return mapBlock(design, args.blockId, b => {
        const options = [...(b.question?.options ?? [])]
        const i = options.findIndex(o => o.id === args.optionId)
        const target = args.direction === 'up' ? i - 1 : i + 1
        if (i === -1 || target < 0 || target >= options.length) return b
        ;[options[i], options[target]] = [options[target], options[i]]
        return { ...b, question: { ...b.question!, options } }
      })

    case 'setPageLogic':
      return mapPages(design, p =>
        p.id === args.pageId
          ? {
              ...p,
              rules: ((args.rules ?? []) as LogicRule[]).map(r => ({ ...r, id: r.id ?? newRuleId() })),
              defaultNext: args.defaultNext ?? undefined,
            }
          : p,
      )

    default:
      return design
  }
}

/**
 * Once a survey has responses its structure is locked: existing questions
 * can't be deleted or change type, and existing options can't be deleted,
 * because stored answers point at them. Wording, design and logic stay
 * editable. Returns a message describing the first violation, or null.
 */
export function checkStructureLock(before: SurveyDesign, after: SurveyDesign): string | null {
  const afterBlocks = new Map(after.pages.flatMap(p => p.blocks).map(b => [b.id, b]))
  for (const page of before.pages) {
    for (const block of page.blocks) {
      if (!isQuestionType(block.type)) continue
      const title = block.question?.title || 'Untitled question'
      const now = afterBlocks.get(block.id)
      if (!now) return `"${title}" already has responses and can't be deleted. Duplicate the survey to make structural changes.`
      if (now.type !== block.type) return `"${title}" already has responses, so its question type can't change.`
      const remaining = new Set((now.question?.options ?? []).map(o => o.id))
      const lost = (block.question?.options ?? []).find(o => !remaining.has(o.id))
      if (lost) return `Option "${lost.label}" on "${title}" already has responses and can't be deleted.`
    }
  }
  return null
}
