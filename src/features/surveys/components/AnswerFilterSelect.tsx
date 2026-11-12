import { Select } from '../../../components/ui/Select'
import { INPUT_CLASS } from '../../../components/ui/Field'
import type { SurveyDesign } from '../../survey-builder/types'
import { filterableQuestions, type AnswerFilter } from '../../survey-builder/logic/answerFilter'

/** Narrow results to the people who gave one answer: one menu, grouped by question ("Q1 · Detractors"). */
export function AnswerFilterSelect({ design, value, onChange }: { design: SurveyDesign; value: AnswerFilter | null; onChange: (f: AnswerFilter | null) => void }) {
  const questions = filterableQuestions(design)
  if (questions.length === 0) return null
  return (
    <Select
      className={`${INPUT_CLASS} !w-auto max-w-[17rem]`}
      value={value ? `${value.questionId}|${value.value}` : ''}
      onChange={e => {
        const [questionId, v] = e.target.value.split('|')
        onChange(e.target.value ? { questionId, value: v } : null)
      }}
      aria-label="Who answered"
    >
      <option value="">Any answer</option>
      {questions.map(q => (
        <optgroup key={q.block.id} label={`Q${q.n}. ${q.block.question?.title ?? ''}`}>
          {q.options.map(o => (
            <option key={o.value} value={`${q.block.id}|${o.value}`}>
              Q{q.n} · {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  )
}
