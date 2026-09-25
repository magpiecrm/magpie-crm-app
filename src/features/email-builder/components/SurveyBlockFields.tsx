import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getSurveyFn, getSurveysFn } from '../../../server/functions'
import { surveyEmailSnapshot } from '../../survey-builder/utils/emailSnippet'
import type { EmailBlock } from '../types'

const inputClass = 'w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs'
const labelClass = 'block text-xs text-muted-foreground font-semibold'

/**
 * Editor for the email `survey` block. Picking a survey (or refreshing) copies
 * its first question onto the block, which is what inline mode renders.
 */
export function SurveyBlockFields({ block, update }: { block: EmailBlock; update: (updates: Partial<EmailBlock>) => void }) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { data: surveys = [] } = useQuery({ queryKey: queryKeys.surveys.list(), queryFn: () => getSurveysFn() })
  const selected = surveys.find(s => s.id === block.surveyId)

  const loadSnapshot = async (surveyId: string, mode = block.surveyMode) => {
    setError('')
    if (!surveyId) {
      update({ surveyId: undefined, surveySnapshot: undefined })
      return
    }
    setLoading(true)
    try {
      const survey = await getSurveyFn({ data: { id: surveyId } })
      const snapshot = surveyEmailSnapshot(survey.name, survey.design) ?? undefined
      update({ surveyId, surveySnapshot: snapshot, surveyMode: mode === 'inline' && !snapshot ? 'button' : mode })
      if (mode === 'inline' && !snapshot) setError("This survey's first question can't be answered in an email, so the block shows a button.")
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load survey')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className={labelClass}>Survey</label>
        <select value={block.surveyId ?? ''} onChange={e => loadSnapshot(e.target.value)} className={inputClass}>
          <option value="">Choose a survey…</option>
          {surveys.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.status !== 'published' ? ` (${s.status})` : ''}
            </option>
          ))}
        </select>
        {selected && selected.status !== 'published' && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Publish this survey before sending the campaign — the send is blocked otherwise. Test emails work with drafts.
          </p>
        )}
        {surveys.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No surveys yet. <Link to="/marketing/surveys" className="text-accent hover:underline">Create one</Link>.
          </p>
        )}
      </div>

      {block.surveyId && (
        <>
          <div className="space-y-2">
            <label className={labelClass}>Display</label>
            <div className="grid grid-cols-2 gap-1">
              {(['button', 'inline'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => (mode === 'inline' ? loadSnapshot(block.surveyId!, 'inline') : update({ surveyMode: 'button' }))}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold border ${
                    (block.surveyMode ?? 'button') === mode ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground'
                  }`}
                >
                  {mode === 'button' ? 'Button' : 'Answer in email'}
                </button>
              ))}
            </div>
            {block.surveyMode === 'inline' && (
              <p className="text-[10px] text-muted-foreground leading-snug">
                Recipients answer the first question with one click; the rest of the survey opens with their answer filled in.
              </p>
            )}
          </div>

          {block.surveyMode === 'inline' && (
            <button
              type="button"
              onClick={() => loadSnapshot(block.surveyId!, 'inline')}
              disabled={loading}
              className="flex items-center gap-1.5 text-[11px] text-accent hover:underline font-semibold disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh question from survey
            </button>
          )}
        </>
      )}
      {error && <p className="text-[11px] text-amber-600 dark:text-amber-400">{error}</p>}

      <div className="space-y-2">
        <label className={labelClass}>Intro text</label>
        <textarea rows={2} value={block.subContent ?? ''} onChange={e => update({ subContent: e.target.value })} className={inputClass} />
      </div>
      {(block.surveyMode ?? 'button') === 'button' && (
        <div className="space-y-2">
          <label className={labelClass}>Button label</label>
          <input value={block.content} onChange={e => update({ content: e.target.value })} className={inputClass} />
        </div>
      )}
    </div>
  )
}
