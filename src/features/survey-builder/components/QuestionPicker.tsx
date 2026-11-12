import type React from 'react'
import { useState } from 'react'
import { Search } from 'lucide-react'
import type { DragPayload } from '../../email-builder/hooks/useBlockDrag'
import type { SurveyBlockType } from '../types'
import { SURVEY_BLOCK_TYPES } from '../types'
import { BLOCK_GROUPS, BLOCK_LOOK, BlockChip } from '../blockIcons'
import { hintClass, inputClass, sectionLabelClass } from './SurveyBlockEditor'

/**
 * Every question and content type, grouped and colour-coded, with a search:
 * the builder's Add tab, and the pop-up a "+" between questions opens. With
 * `startDrag`, items can also be dragged onto the canvas.
 */
export function QuestionPicker({
  onPick,
  startDrag,
  didDrag,
  autoFocus,
  columns = 2,
}: {
  onPick: (type: SurveyBlockType) => void
  startDrag?: (e: React.PointerEvent, payload: DragPayload<SurveyBlockType>) => void
  didDrag?: React.RefObject<boolean>
  autoFocus?: boolean
  columns?: 2 | 3
}) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const matches = (t: (typeof SURVEY_BLOCK_TYPES)[number]) => !q || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input autoFocus={autoFocus} value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a question type" aria-label="Find a question type" className={`${inputClass} pl-8`} />
      </div>
      {BLOCK_GROUPS.map(group => {
        const items = SURVEY_BLOCK_TYPES.filter(t => BLOCK_LOOK[t.type].group === group.id && matches(t))
        if (items.length === 0) return null
        return (
          <div key={group.id}>
            <h3 className={sectionLabelClass}>{group.label}</h3>
            <div className={`mt-2 grid select-none gap-1.5 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:max-lg:grid-cols-3'}`}>
              {items.map(item => (
                <button
                  key={item.type}
                  type="button"
                  title={item.description}
                  onClick={() => {
                    // A completed drag already inserted the block.
                    if (didDrag?.current) return
                    onPick(item.type)
                  }}
                  onPointerDown={startDrag ? e => startDrag(e, { kind: 'new', blockType: item.type }) : undefined}
                  className={`flex min-h-10 items-center gap-1.5 rounded-md-s border border-border bg-card px-1.5 py-1.5 text-left text-[13px] font-medium tracking-[-0.005em] text-foreground transition-colors hover:border-foreground/25 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                    startDrag ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer'
                  }`}
                >
                  <BlockChip type={item.type} size="sm" />
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {q && !SURVEY_BLOCK_TYPES.some(matches) && <p className={hintClass}>No question type called “{search.trim()}”.</p>}
    </div>
  )
}
