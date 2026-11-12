import type React from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import type { ConditionOp, LogicRule, PageTarget, SurveyBlock, SurveyDesign, SurveyPage } from '../types'
import { CHOICE_TYPES, isQuestionType } from '../types'
import { newRuleId } from '../applyAction'
import type { LintIssue } from '../logic/lint'
import { scaleRange } from '../logic/validate'
import { OP_LABELS, describeCondition, describeTarget } from '../logic/describe'
import type { Dispatch } from './SurveyBlockEditor'
import { hintClass, inputClass, labelClass, sectionLabelClass } from './SurveyBlockEditor'
import { Select } from '../../../components/ui/Select'

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
    <div className="flex-1 space-y-5 overflow-y-auto p-5 custom-scrollbar">
      <div className="space-y-1.5">
        <h3 className={sectionLabelClass}>Where people go next</h3>
        <p className={hintClass}>After each page, the first rule that matches decides where they go; with none, they go on to the next page. Rules only jump forward.</p>
      </div>

      {issues.length > 0 && (
        <div className="space-y-2 rounded-md-s border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2.5 dark:bg-amber-500/10">
          {issues.map((issue, i) => (
            <p key={i} className={`flex items-start gap-2 text-[13px] leading-relaxed ${issue.level === 'error' ? 'text-destructive' : 'text-foreground'}`}>
              <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${issue.level === 'error' ? '' : 'text-amber-600 dark:text-amber-400'}`} aria-hidden />
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
    <Select value={targetValue(value)} onChange={e => onChange(parseTarget(e.target.value))} className={inputClass} aria-label="Go to">
      <option value="next">{laterPages.length ? 'The next page' : 'Finish the survey'}</option>
      {laterPages.map(p => (
        <option key={p.id} value={`page:${p.id}`}>
          {design.pages.indexOf(p) + 1}. {p.title || `Page ${design.pages.indexOf(p) + 1}`}
        </option>
      ))}
      {laterPages.length > 0 && <option value="end">Finish the survey</option>}
    </Select>
  )

  return (
    <div className="space-y-3 rounded-md-m border border-border bg-card p-3.5 dark:bg-white/[0.03]">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground/[0.08] px-1 text-[11px] tabular-nums">{index + 1}</span>
        {page.title || `Page ${index + 1}`}
      </div>

      {rules.map(rule => (
        <RuleRow
          key={rule.id}
          design={design}
          pageIndex={index}
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
          className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md-s px-2 text-[13px] font-medium text-accent hover:bg-accent/10"
        >
          <Plus className="h-3.5 w-3.5" /> Add a rule
        </button>
      )}

      <div className="space-y-1.5">
        <label className={labelClass}>{rules.length ? 'Everyone else goes to' : 'Everyone goes to'}</label>
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
  design,
  pageIndex,
  rule,
  questions,
  targetSelect,
  onChange,
  onDelete,
}: {
  design: SurveyDesign
  pageIndex: number
  rule: LogicRule
  questions: SurveyBlock[]
  targetSelect: (value: PageTarget | undefined, onChange: (t: PageTarget) => void) => React.ReactNode
  onChange: (rule: LogicRule) => void
  onDelete: () => void
}) {
  const header = (
    <div className="flex items-start justify-between gap-2">
      <p className="pt-1.5 text-[13px] font-medium leading-snug text-foreground">
        If {describeCondition(design, rule.when)}, go to {describeTarget(design, rule.goTo, pageIndex)}
      </p>
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md-s text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        aria-label="Delete this rule"
        title="Delete this rule"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )

  if (!('questionId' in rule.when)) {
    return (
      <div className="space-y-1.5">
        {header}
        <p className={hintClass}>Several conditions together, set by the copilot. Change them through the copilot, or delete the rule.</p>
        {targetSelect(rule.goTo, goTo => onChange({ ...rule, goTo }))}
      </div>
    )
  }

  const when = rule.when
  const question = questions.find(q => q.id === when.questionId)
  const ops = opsFor(question)
  const setWhen = (patch: Partial<typeof when>) => onChange({ ...rule, when: { ...when, ...patch } })

  return (
    <div className="space-y-2 rounded-md-s border border-border bg-background p-2.5">
      {header}
      <Select
        aria-label="Question"
        value={when.questionId}
        onChange={e => {
          const q = questions.find(x => x.id === e.target.value)!
          const op = opsFor(q)[0]
          setWhen({ questionId: q.id, op, value: defaultValue(q, op) })
        }}
        className={inputClass}
      >
        {!question && <option value={when.questionId}>(deleted question)</option>}
        {questions.map((q, i) => (
          <option key={q.id} value={q.id}>
            Q{i + 1}. {q.question?.title || 'Untitled question'}
          </option>
        ))}
      </Select>
      <div className={`grid gap-2 ${needsValue(when.op) && question ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <Select
          value={when.op}
          aria-label="Is"
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
        </Select>
        {needsValue(when.op) && question && <ValueInput question={question} value={when.value} onChange={value => setWhen({ value })} />}
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
        <span className="text-[13px] text-muted-foreground">go to</span>
        {targetSelect(rule.goTo, goTo => onChange({ ...rule, goTo }))}
      </div>
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
      <Select value={String(value ?? '')} onChange={e => onChange(e.target.value)} className={inputClass}>
        {question.question.options.map(o => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    )
  }
  if (question.type === 'nps') {
    const group = (n: number) => (n === 6 ? ' · detractors to here' : n === 8 ? ' · passives to here' : n === 9 ? ' · promoters from here' : '')
    return (
      <Select value={String(value ?? '')} onChange={e => onChange(Number(e.target.value))} className={inputClass} aria-label="Score">
        {Array.from({ length: 11 }, (_, n) => (
          <option key={n} value={n}>
            {n}
            {group(n)}
          </option>
        ))}
      </Select>
    )
  }
  if (question.type === 'yes_no') {
    return (
      <Select value={String(value)} onChange={e => onChange(e.target.value === 'true')} className={inputClass}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    )
  }
  return <input type="number" value={typeof value === 'number' ? value : ''} onChange={e => onChange(Number(e.target.value))} className={inputClass} />
}
