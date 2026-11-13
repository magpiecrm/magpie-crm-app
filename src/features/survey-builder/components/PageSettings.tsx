import { CornerDownRight, MousePointerClick } from 'lucide-react'
import type { SurveyDesign } from '../types'
import { isQuestionType } from '../types'
import { describePageRouteParts } from '../logic/describe'
import { Button } from '../../../components/ui/Button'
import type { Dispatch } from './SurveyBlockEditor'
import { hintClass, inputClass, labelClass, sectionLabelClass } from './SurveyBlockEditor'

/**
 * The right-hand column when no question is selected: the page you're on,
 * its name, what's on it, where it leads and what its button says, with the
 * way to change each. Pick a question to change that instead.
 */
export function PageSettings({ design, pageId, dispatch, onOpenLogic, onOpenStyle }: { design: SurveyDesign; pageId: string | null; dispatch: Dispatch; onOpenLogic: () => void; onOpenStyle: () => void }) {
  const index = Math.max(0, design.pages.findIndex(p => p.id === pageId))
  const page = design.pages[index]
  if (!page) return null
  const questions = page.blocks.filter(b => isQuestionType(b.type)).length
  const routes = describePageRouteParts(design, index)
  const last = index === design.pages.length - 1
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-foreground/[0.08] px-1 text-xs font-semibold tabular-nums text-foreground">{index + 1}</span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Page {index + 1} of {design.pages.length}</h2>
      </div>
      <div className="flex flex-col gap-5 p-4">
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor={`page-name-${page.id}`}>
            Name
          </label>
          <input
            id={`page-name-${page.id}`}
            key={page.id}
            defaultValue={page.title ?? ''}
            placeholder={`Page ${index + 1}`}
            onBlur={e => dispatch('survey.updatePage', { id: page.id, updates: { title: e.target.value.trim() || undefined } })}
            className={inputClass}
          />
          <p className={hintClass}>Only you see it: it names the page in the outline, the logic and the results.</p>
        </div>
        <div className="space-y-1.5">
          <h3 className={sectionLabelClass}>On it</h3>
          <p className="text-[13px] text-foreground">
            {questions ? `${questions} question${questions === 1 ? '' : 's'}` : 'No questions yet'}
            {page.blocks.length > questions && `, ${page.blocks.length - questions} other block${page.blocks.length - questions === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="space-y-2">
          <h3 className={sectionLabelClass}>Where people go next</h3>
          {routes.length ? (
            <ul className="space-y-1 text-[13px] text-foreground">
              {routes.map((r, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  <span>
                    {r.lead} <span className="font-medium">{r.target}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-foreground">{last ? 'Everyone finishes here.' : 'Everyone goes on to the next page.'}</p>
          )}
          <Button variant="secondary" size="sm" onClick={onOpenLogic}>
            {routes.length ? 'Change in Logic' : 'Add a rule in Logic'}
          </Button>
        </div>
        <div className="space-y-2">
          <h3 className={sectionLabelClass}>Its button</h3>
          <p className="text-[13px] text-foreground">
            Says “{last ? design.theme.submitLabel : design.theme.nextLabel}”{design.theme.showProgressBar && design.pages.length > 1 ? ', under a progress bar' : ''}.
          </p>
          <Button variant="secondary" size="sm" onClick={onOpenStyle}>
            Change in Style
          </Button>
        </div>
        <p className="flex items-start gap-2 border-t border-border pt-4 text-[13px] leading-relaxed text-muted-foreground">
          <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Select a question on the page or in the outline to change it. You can type its wording right on the page.
        </p>
      </div>
    </div>
  )
}
