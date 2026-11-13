import { ChevronRight, Loader2, Plus } from 'lucide-react'
import type { SurveyBlock, SurveyTheme } from '../../survey-builder/types'
import { DEFAULT_SURVEY_THEME, isQuestionType } from '../../survey-builder/types'
import { SurveyBlockView } from '../../survey-builder/runtime/SurveyBlockView'
import { SURVEY_STARTER_TEMPLATES } from '../../survey-builder/templates/starters'

/**
 * A starter's first page as it will look, drawn small: the real blocks in the
 * default style, laid out at 520px and scaled to the tile.
 */
function Miniature({ blocks, theme }: { blocks: SurveyBlock[]; theme: SurveyTheme }) {
  const W = 520
  const SCALE = 0.2
  return (
    <span aria-hidden className="relative block h-[84px] w-[104px] shrink-0 overflow-hidden rounded-md-s border border-border" style={{ background: theme.pageBgColor }}>
      <span
        className="pointer-events-none absolute left-0 top-0 block origin-top-left select-none"
        style={{ width: W, transform: `scale(${SCALE})`, padding: 28, fontFamily: theme.fontFamily, lineHeight: theme.lineHeight, color: theme.textColor }}
      >
        <span className="block" style={{ background: theme.cardBgColor, borderRadius: 14, padding: '28px 28px 20px', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
          {blocks.slice(0, 4).map(b => (
            <SurveyBlockView key={b.id} block={b} theme={theme} disabled />
          ))}
        </span>
      </span>
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
            <Miniature blocks={pages[0]?.blocks ?? []} theme={{ ...DEFAULT_SURVEY_THEME, ...t.theme }} />
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
        <span aria-hidden className="flex h-[84px] w-[104px] shrink-0 items-center justify-center rounded-md-s border border-dashed border-border text-foreground/60">
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
