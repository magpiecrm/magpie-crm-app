import type React from 'react'
import { AlertTriangle, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import type { Condition, ConditionOp, LogicRule, PageTarget, SurveyBlock, SurveyDesign, SurveyPage } from '../types'
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

  const [editing, setEditing] = useState<string | null>(null)
  const save = (nextRules: LogicRule[], defaultNext = page.defaultNext) =>
    dispatch('survey.setPageLogic', { pageId: page.id, rules: nextRules, defaultNext })

  const targetSelect = (value: PageTarget | undefined, onChange: (t: PageTarget) => void) => (
    <Select value={targetValue(value)} onChange={e => onChange(parseTarget(e.target.value))} className={inputClass} aria-label="Go to">
      <option value="next">{laterPages.length ? 'The next page' : 'The end'}</option>
      {laterPages.map(p => (
        <option key={p.id} value={`page:${p.id}`}>
          {design.pages.indexOf(p) + 1}. {p.title || `Page ${design.pages.indexOf(p) + 1}`}
        </option>
      ))}
      {laterPages.length > 0 && <option value="end">The end</option>}
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
          editing={editing === rule.id}
          setEditing={open => setEditing(open ? rule.id : null)}
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
            const id = newRuleId()
            save([...rules, { id, when: { questionId: q.id, op, value: defaultValue(q, op) }, goTo: { kind: 'end' } }])
            setEditing(id)
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

type Simple = Extract<Condition, { questionId: string }>

/** A rule's condition as the pop-up edits it: one or more simple conditions, all or any of which must hold. Null when it's nested deeper (the copilot's). */
function flatten(when: Condition): { join: 'all' | 'any'; conds: Simple[] } | null {
  if ('questionId' in when) return { join: 'all', conds: [when] }
  const list = 'all' in when ? when.all : when.any
  if (!list.every(c => 'questionId' in c)) return null
  return { join: 'all' in when ? 'all' : 'any', conds: list as Simple[] }
}

function unflatten(join: 'all' | 'any', conds: Simple[]): Condition {
  if (conds.length === 1) return conds[0]
  return join === 'all' ? { all: conds } : { any: conds }
}

function RuleRow({
  design,
  pageIndex,
  rule,
  questions,
  targetSelect,
  editing,
  setEditing,
  onChange,
  onDelete,
}: {
  editing: boolean
  setEditing: (open: boolean) => void
  design: SurveyDesign
  pageIndex: number
  rule: LogicRule
  questions: SurveyBlock[]
  targetSelect: (value: PageTarget | undefined, onChange: (t: PageTarget) => void) => React.ReactNode
  onChange: (rule: LogicRule) => void
  onDelete: () => void
}) {
  // The pop-up changes a draft; Save keeps it, Cancel (or closing) leaves the rule as it was.
  const [draft, setDraft] = useState<{ join: 'all' | 'any'; conds: Simple[]; goTo: PageTarget } | null>(null)
  const flat = flatten(rule.when)
  const iconButton =
    'inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md-s text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
  const open = () => {
    if (!flat) return
    setDraft({ join: flat.join, conds: flat.conds, goTo: rule.goTo })
    setEditing(true)
  }
  // A rule just added opens straight away; give it its draft.
  if (editing && !draft && flat) setDraft({ join: flat.join, conds: flat.conds, goTo: rule.goTo })

  const header = (
    <div className="flex items-start gap-1">
      <button type="button" onClick={open} className="group min-w-0 flex-1 cursor-pointer pt-1.5 text-left text-[13px] leading-snug text-foreground">
        <span className="block font-medium group-hover:underline">If {describeCondition(design, rule.when)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-muted-foreground">
          go to <span className="rounded-full bg-accent/10 px-2 py-px font-medium text-foreground">{describeTarget(design, rule.goTo, pageIndex)}</span>
        </span>
      </button>
      {flat && (
        <button type="button" onClick={open} className={iconButton} aria-label="Change this rule" title="Change this rule">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      <button type="button" onClick={onDelete} className={`${iconButton} hover:!text-destructive`} aria-label="Delete this rule" title="Delete this rule">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )

  if (!flat) {
    return (
      <div className="space-y-1.5">
        {header}
        <p className={hintClass}>Conditions inside conditions, set by the copilot. Change them through the copilot, or delete the rule.</p>
        {targetSelect(rule.goTo, goTo => onChange({ ...rule, goTo }))}
      </div>
    )
  }

  const d = draft ?? { join: flat.join, conds: flat.conds, goTo: rule.goTo }
  const setCond = (i: number, patch: Partial<Simple>) => setDraft({ ...d, conds: d.conds.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const close = () => (setDraft(null), setEditing(false))
  const draftWhen = unflatten(d.join, d.conds)

  return (
    <div className="rounded-md-s border border-border bg-background p-2.5">
      {header}
      <Dialog isOpen={editing} onClose={close} title="Change this rule" description={`If ${describeCondition(design, draftWhen)}, go to ${describeTarget(design, d.goTo, pageIndex)}`} className="sm:max-w-2xl">
        <DialogBody className="flex flex-col gap-4">
          <span className={labelClass}>{d.conds.length > 1 ? 'Conditions' : 'If the answer to'}</span>
          {d.conds.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-foreground">
              It applies when
              <div role="radiogroup" aria-label="Which conditions" className="inline-flex gap-0.5 rounded-md-s bg-muted p-0.5">
                {(['all', 'any'] as const).map(j => (
                  <button
                    key={j}
                    type="button"
                    role="radio"
                    aria-checked={d.join === j}
                    onClick={() => setDraft({ ...d, join: j })}
                    className={`inline-flex min-h-8 cursor-pointer items-center rounded-md-xs px-3 font-medium transition-colors ${
                      d.join === j ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.08)] dark:bg-white/10' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {j === 'all' ? 'all of these' : 'any of these'}
                  </button>
                ))}
              </div>
              are true
            </div>
          )}
          {/* One line per condition, joined by an and/or pill; the NPS groups are explained once below. */}
          <ol className="flex flex-col gap-2">
            {d.conds.map((c, i) => {
              const question = questions.find(q => q.id === c.questionId)
              const ops = opsFor(question)
              return (
                <li key={i} className="flex flex-col gap-2">
                  {i > 0 && (
                    <span className="self-start rounded-full bg-foreground/[0.07] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground">{d.join === 'all' ? 'and' : 'or'}</span>
                  )}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_8.5rem_auto]">
                    <Select
                      aria-label="Question"
                      value={c.questionId}
                      onChange={e => {
                        const q = questions.find(x => x.id === e.target.value)!
                        const op = opsFor(q)[0]
                        setCond(i, { questionId: q.id, op, value: defaultValue(q, op) })
                      }}
                      className={`${inputClass} max-sm:col-span-2`}
                    >
                      {!question && <option value={c.questionId}>(deleted question)</option>}
                      {questions.map((q, k) => (
                        <option key={q.id} value={q.id}>
                          Q{k + 1}. {q.question?.title || 'Untitled question'}
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={c.op}
                      aria-label="Is"
                      onChange={e => {
                        const op = e.target.value as ConditionOp
                        setCond(i, { op, value: question ? defaultValue(question, op) : undefined })
                      }}
                      className={inputClass}
                    >
                      {ops.map(op => (
                        <option key={op} value={op}>
                          {OP_LABELS[op]}
                        </option>
                      ))}
                    </Select>
                    {needsValue(c.op) && question ? <ValueInput question={question} value={c.value} onChange={value => setCond(i, { value })} /> : <span className="max-sm:hidden" />}
                    <button
                      type="button"
                      disabled={d.conds.length === 1}
                      onClick={() => setDraft({ ...d, conds: d.conds.filter((_, j) => j !== i) })}
                      className={`${iconButton} self-center hover:!text-destructive disabled:invisible`}
                      aria-label="Remove this condition"
                      title="Remove this condition"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
          {d.conds.some(c => questions.find(q => q.id === c.questionId)?.type === 'nps') && <p className={hintClass}>Detractors score 0–6, passives 7–8 and promoters 9–10.</p>}
          <div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => {
                const q = questions[questions.length - 1]
                const op = opsFor(q)[0]
                setDraft({ ...d, conds: [...d.conds, { questionId: q.id, op, value: defaultValue(q, op) }] })
              }}
            >
              Add a condition
            </Button>
          </div>
          <div className="space-y-1.5">
            <span className={labelClass}>Then go to</span>
            {targetSelect(d.goTo, goTo => setDraft({ ...d, goTo }))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" leftIcon={<Trash2 className="h-4 w-4" />} className="sm:mr-auto !text-destructive hover:!bg-destructive/10" onClick={() => (close(), onDelete())}>
            Delete rule
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onChange({ ...rule, when: draftWhen, goTo: d.goTo })
              close()
            }}
          >
            Save rule
          </Button>
        </DialogFooter>
      </Dialog>
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
    const group = (n: number) => (n === 6 ? ' · detractors' : n === 8 ? ' · passives' : n === 9 ? ' · promoters' : '')
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
