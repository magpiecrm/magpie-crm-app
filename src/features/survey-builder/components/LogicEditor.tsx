import type React from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import type { ConditionOp, LogicRule, PageTarget, SurveyBlock, SurveyDesign, SurveyPage } from '../types'
import { CHOICE_TYPES, isQuestionType } from '../types'
import { newRuleId } from '../applyAction'
import type { LintIssue } from '../logic/lint'
import { scaleRange } from '../logic/validate'
import type { Dispatch } from './SurveyBlockEditor'
import { inputClass, labelClass, sectionLabelClass } from './SurveyBlockEditor'

const OP_LABELS: Record<ConditionOp, string> = {
  answered: 'is answered',
  not_answered: 'is not answered',
  eq: 'is',
  neq: 'is not',
  includes: 'includes',
  not_includes: 'does not include',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
}

function opsFor(block: SurveyBlock | undefined): ConditionOp[] {
  if (!block) return ['answered', 'not_answered']
  if (block.type === 'multiple_choice') return ['includes', 'not_includes', 'answered', 'not_answered']
  if (CHOICE_TYPES.includes(block.type as never)) return ['eq', 'neq', 'answered', 'not_answered']
  if (['rating', 'nps', 'scale', 'number'].includes(block.type)) return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'answered', 'not_answered']
  if (block.type === 'yes_no') return ['eq', 'answered', 'not_answered']
  return ['answered', 'not_answered']
}

const needsValue = (op: ConditionOp) => op !== 'answered' && op !== 'not_answered'

function targetValue(t: PageTarget | undefined): string {
  if (!t || t.kind === 'next') return 'next'
  return t.kind === 'end' ? 'end' : `page:${t.pageId}`
}

function parseTarget(v: string): PageTarget {
  if (v === 'end') return { kind: 'end' }
  if (v.startsWith('page:')) return { kind: 'page', pageId: v.slice(5) }
  return { kind: 'next' }
}

interface LogicEditorProps {
  design: SurveyDesign
  dispatch: Dispatch
  issues: LintIssue[]
}

/**
 * Per-page branching. The UI edits one simple condition per rule; nested
 * all/any conditions (e.g. written by the copilot) are shown read-only.
 */
export function LogicEditor({ design, dispatch, issues }: LogicEditorProps) {
  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
      <div>
        <span className={sectionLabelClass}>Skip logic</span>
        <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
          After each page, the first matching rule decides where to go. Jumps can only go forward.
        </p>
      </div>

      {issues.length > 0 && (
        <div className="space-y-1.5 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
          {issues.map((issue, i) => (
            <p key={i} className={`flex gap-1.5 text-[11px] leading-snug ${issue.level === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}`}>
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              {issue.message}
            </p>
          ))}
        </div>
      )}

      {design.pages.map((page, i) => (
        <PageLogic key={page.id} design={design} page={page} index={i} dispatch={dispatch} />
      ))}
    </div>
  )
}

function PageLogic({ design, page, index, dispatch }: { design: SurveyDesign; page: SurveyPage; index: number; dispatch: Dispatch }) {
  const rules = page.rules ?? []
  // Questions on this page or earlier can drive a rule.
  const questions = design.pages.slice(0, index + 1).flatMap(p => p.blocks.filter(b => isQuestionType(b.type)))
  const laterPages = design.pages.slice(index + 1)

  const save = (nextRules: LogicRule[], defaultNext = page.defaultNext) =>
    dispatch('survey.setPageLogic', { pageId: page.id, rules: nextRules, defaultNext })

  const targetSelect = (value: PageTarget | undefined, onChange: (t: PageTarget) => void) => (
    <select value={targetValue(value)} onChange={e => onChange(parseTarget(e.target.value))} className={inputClass}>
      <option value="next">{laterPages.length ? 'Next page' : 'End (submit)'}</option>
      {laterPages.map(p => (
        <option key={p.id} value={`page:${p.id}`}>
          Go to {p.title || `Page ${design.pages.indexOf(p) + 1}`}
        </option>
      ))}
      <option value="end">End survey</option>
    </select>
  )

  return (
    <div className="space-y-3 p-3 rounded-xl border border-border bg-muted/10">
      <div className="text-xs font-bold text-foreground">{page.title || `Page ${index + 1}`}</div>

      {rules.map(rule => (
        <RuleRow
          key={rule.id}
          rule={rule}
          questions={questions}
          targetSelect={targetSelect}
          onChange={updated => save(rules.map(r => (r.id === rule.id ? updated : r)))}
          onDelete={() => save(rules.filter(r => r.id !== rule.id))}
        />
      ))}

      {questions.length > 0 && (
        <button
          type="button"
          onClick={() => {
            const q = questions[questions.length - 1]
            const op = opsFor(q)[0]
            save([...rules, { id: newRuleId(), when: { questionId: q.id, op, value: defaultValue(q, op) }, goTo: { kind: 'end' } }])
          }}
          className="flex items-center gap-1 text-[10px] text-accent hover:underline font-semibold"
        >
          <Plus className="w-3 h-3" /> Add rule
        </button>
      )}

      <div className="space-y-1">
        <label className={labelClass}>{rules.length ? 'Otherwise' : 'After this page'}</label>
        {targetSelect(page.defaultNext, t => save(rules, t.kind === 'next' ? undefined : t))}
      </div>
    </div>
  )
}

function defaultValue(block: SurveyBlock, op: ConditionOp): string | number | boolean | undefined {
  if (!needsValue(op)) return undefined
  if (block.type === 'yes_no') return true
  if (block.question?.options?.length) return block.question.options[0].id
  if (['rating', 'nps', 'scale'].includes(block.type)) return scaleRange(block).min
  return 0
}

function RuleRow({
  rule,
  questions,
  targetSelect,
  onChange,
  onDelete,
}: {
  rule: LogicRule
  questions: SurveyBlock[]
  targetSelect: (value: PageTarget | undefined, onChange: (t: PageTarget) => void) => React.ReactNode
  onChange: (rule: LogicRule) => void
  onDelete: () => void
}) {
  const header = (
    <div className="flex justify-between items-center">
      <span className={labelClass}>If</span>
      <button type="button" onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive" aria-label="Delete rule">
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  )

  if (!('questionId' in rule.when)) {
    return (
      <div className="space-y-1.5">
        {header}
        <p className="text-[10px] text-muted-foreground">A combined condition (set by the copilot). Edit it via the copilot or delete it.</p>
        {targetSelect(rule.goTo, goTo => onChange({ ...rule, goTo }))}
      </div>
    )
  }

  const when = rule.when
  const question = questions.find(q => q.id === when.questionId)
  const ops = opsFor(question)
  const setWhen = (patch: Partial<typeof when>) => onChange({ ...rule, when: { ...when, ...patch } })

  return (
    <div className="space-y-1.5 pb-3 border-b border-border/50">
      {header}
      <select
        value={when.questionId}
        onChange={e => {
          const q = questions.find(x => x.id === e.target.value)!
          const op = opsFor(q)[0]
          setWhen({ questionId: q.id, op, value: defaultValue(q, op) })
        }}
        className={inputClass}
      >
        {!question && <option value={when.questionId}>(deleted question)</option>}
        {questions.map(q => (
          <option key={q.id} value={q.id}>
            {q.question?.title || 'Untitled question'}
          </option>
        ))}
      </select>
      <select
        value={when.op}
        onChange={e => {
          const op = e.target.value as ConditionOp
          setWhen({ op, value: question ? defaultValue(question, op) : undefined })
        }}
        className={inputClass}
      >
        {ops.map(op => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>
      {needsValue(when.op) && question && <ValueInput question={question} value={when.value} onChange={value => setWhen({ value })} />}
      <label className={labelClass}>Then</label>
      {targetSelect(rule.goTo, goTo => onChange({ ...rule, goTo }))}
    </div>
  )
}

function ValueInput({
  question,
  value,
  onChange,
}: {
  question: SurveyBlock
  value: string | number | boolean | undefined
  onChange: (v: string | number | boolean) => void
}) {
  if (question.question?.options?.length) {
    return (
      <select value={String(value ?? '')} onChange={e => onChange(e.target.value)} className={inputClass}>
        {question.question.options.map(o => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  if (question.type === 'yes_no') {
    return (
      <select value={String(value)} onChange={e => onChange(e.target.value === 'true')} className={inputClass}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  }
  return <input type="number" value={typeof value === 'number' ? value : ''} onChange={e => onChange(Number(e.target.value))} className={inputClass} />
}
