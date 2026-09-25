import type React from 'react'
import { ArrowDown, ArrowUp, GripVertical, Lock, Trash2 } from 'lucide-react'
import type { DragPayload } from '../../email-builder/hooks/useBlockDrag'
import type { SurveyBlock, SurveyBlockType, SurveyTheme } from '../types'
import { SurveyBlockView } from '../runtime/SurveyBlockView'

interface SurveyBlockFrameProps {
  block: SurveyBlock
  index: number
  pageId: string
  blocksLength: number
  theme: SurveyTheme
  selected: boolean
  dragging: boolean
  locked: boolean
  showDropLine: boolean
  onSelect: () => void
  onMove: (direction: 'up' | 'down') => void
  onDelete: () => void
  startDrag: (e: React.PointerEvent, payload: DragPayload<SurveyBlockType>) => void
}

/**
 * Selection, toolbar and drag wrapper around one block on the canvas — the
 * survey counterpart of the email builder's `BlockRenderer`. The block itself
 * is drawn by the same `SurveyBlockView` respondents see.
 */
export function SurveyBlockFrame({
  block,
  index,
  pageId,
  blocksLength,
  theme,
  selected,
  dragging,
  locked,
  showDropLine,
  onSelect,
  onMove,
  onDelete,
  startDrag,
}: SurveyBlockFrameProps) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div
      data-block-index={index}
      onClick={stop(onSelect)}
      className={`relative group rounded-md transition-all ${dragging ? 'opacity-40' : ''} ${
        selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-transparent' : 'hover:ring-1 hover:ring-accent/40'
      }`}
    >
      {showDropLine && <div className="absolute -top-1 left-0 right-0 h-0.5 bg-accent rounded-full pointer-events-none z-10" />}

      {/* Inputs are visible but inert on the canvas; clicks select the block. */}
      <div className="pointer-events-none select-none">
        <SurveyBlockView block={block} theme={theme} disabled />
      </div>

      <div
        className={`absolute right-1 -top-3 flex-row gap-0.5 bg-card border border-border rounded-lg shadow-sm p-0.5 z-20 ${
          selected ? 'flex' : 'hidden group-hover:flex'
        }`}
      >
        <button
          onPointerDown={e => startDrag(e, { kind: 'move', index, pageId })}
          onClick={e => e.stopPropagation()}
          className="p-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
          aria-label="Drag block"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        <button disabled={index === 0} onClick={stop(() => onMove('up'))} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Move up">
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          disabled={index === blocksLength - 1}
          onClick={stop(() => onMove('down'))}
          className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Move down"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
        {locked ? (
          <span className="p-1 text-amber-500" title="Has responses — can't be deleted">
            <Lock className="w-3.5 h-3.5" />
          </span>
        ) : (
          <button onClick={stop(onDelete)} className="p-1 text-muted-foreground hover:text-destructive" aria-label="Delete block">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
