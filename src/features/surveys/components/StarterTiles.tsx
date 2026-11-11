import { ChevronRight, Loader2, Plus } from 'lucide-react'
import type { SurveyBlock } from '../../survey-builder/types'
import { isQuestionType } from '../../survey-builder/types'
import { SURVEY_STARTER_TEMPLATES } from '../../survey-builder/templates/starters'

/** A small drawing of a survey's first questions: a score row, stars, choices or a text box. */
function Sketch({ blocks }: { blocks: SurveyBlock[] }) {
  const questions = blocks.filter(b => isQuestionType(b.type)).slice(0, 3)
  const bar = 'block rounded-[2px] bg-foreground/[0.12]'
  return (
    <span aria-hidden className="flex h-[58px] w-[58px] shrink-0 flex-col gap-[5px] rounded-md-s border border-border bg-background p-1.5">
      {questions.map(q => (
        <span key={q.id} className="flex flex-col gap-[2px]">
          <span className="block h-[3px] w-3/4 rounded-[2px] bg-foreground/35" />
          {q.type === 'nps' || q.type === 'scale' ? (
            <span className="flex gap-[1.5px]">
              {Array.from({ length: q.type === 'nps' ? 9 : 7 }, (_, i) => <span key={i} className={`h-[5px] flex-1 ${bar}`} />)}
            </span>
          ) : q.type === 'rating' ? (
            <span className="flex gap-[2px] text-[7px] leading-[7px] text-foreground/35">★★★★★</span>
          ) : q.type === 'long_text' ? (
            <span className={`h-[8px] ${bar}`} />
          ) : ['single_choice', 'multiple_choice', 'yes_no'].includes(q.type) ? (
            <span className="flex gap-[2px]">
              <span className={`h-[5px] flex-1 ${bar}`} />
              <span className={`h-[5px] flex-1 ${bar}`} />
            </span>
          ) : (
            <span className={`h-[5px] ${bar}`} />
          )}
        </span>
      ))}
    </span>
  )
}

const tile =
  'group flex w-full cursor-pointer items-start gap-3 rounded-md-m border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait'

/**
 * Where a new survey can start: the empty Surveys page and New survey both
 * show these. Picking one makes the survey and opens it in the builder.
 */
export function StarterTiles({ onPick, pending }: { onPick: (templateId: string) => void; pending: string | null }) {
  const starters = SURVEY_STARTER_TEMPLATES.filter(t => t.id !== 'blank')
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {starters.map(t => {
        const pages = t.build()
        const questions = pages.flatMap(p => p.blocks.filter(b => isQuestionType(b.type)))
        return (
          <button key={t.id} type="button" className={tile} disabled={!!pending} onClick={() => onPick(t.id)}>
            <Sketch blocks={pages.flatMap(p => p.blocks)} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-foreground">{t.name}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">{t.description}</span>
              <span className="mt-1.5 block text-[13px] text-muted-foreground">
                {questions.length} question{questions.length === 1 ? '' : 's'}
                {pages.length > 1 && ` on ${pages.length} pages`}
              </span>
            </span>
            {pending === t.id ? (
              <Loader2 className="mt-2.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Making it" />
            ) : (
              <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            )}
          </button>
        )
      })}
      <button type="button" className={tile} disabled={!!pending} onClick={() => onPick('blank')}>
        <span aria-hidden className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-md-s border border-dashed border-border text-foreground/60">
          <Plus className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-foreground">Blank survey</span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">One empty page. Add the questions yourself.</span>
        </span>
        {pending === 'blank' ? (
          <Loader2 className="mt-2.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Making it" />
        ) : (
          <ChevronRight className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
        )}
      </button>
    </div>
  )
}
