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
const tool =
  'inline-flex h-8 w-8 items-center justify-center rounded-md-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent'

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
      className={`relative group rounded-md outline-offset-[6px] transition-[outline-color,opacity] ${dragging ? 'opacity-40' : ''} ${
        selected ? 'outline-2 outline-solid outline-accent' : 'outline-1 outline-solid outline-transparent hover:outline-accent/45'
      }`}
    >
      {showDropLine && <div className="absolute -top-1 left-0 right-0 h-0.5 bg-accent rounded-full pointer-events-none z-10" />}

      {/* Inputs are visible but inert on the canvas; clicks select the block. */}
      <div className="pointer-events-none select-none">
        <SurveyBlockView block={block} theme={theme} disabled />
      </div>

      {/* Beside the card on a wide screen, above the outline on a narrow one: never over the block's own text. */}
      <div
        className={`absolute -right-[6px] -top-[46px] z-20 flex-row items-center gap-0.5 rounded-md-s border border-border bg-popover p-0.5 font-sans text-foreground shadow-md lg:-top-[7px] lg:left-[calc(100%+var(--sv-card-pad,32px)+12px)] lg:right-auto lg:flex-col ${
          selected ? 'flex' : 'hidden group-hover:flex'
        }`}
      >
        <button
          onPointerDown={e => startDrag(e, { kind: 'move', index, pageId })}
          onClick={e => e.stopPropagation()}
          className={`${tool} cursor-grab active:cursor-grabbing touch-none`}
          aria-label="Drag to move"
          title="Drag to move"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button disabled={index === 0} onClick={stop(() => onMove('up'))} className={tool} aria-label="Move up" title="Move up">
          <ArrowUp className="h-4 w-4" />
        </button>
        <button disabled={index === blocksLength - 1} onClick={stop(() => onMove('down'))} className={tool} aria-label="Move down" title="Move down">
          <ArrowDown className="h-4 w-4" />
        </button>
        <span className="mx-0.5 h-5 w-px bg-border lg:mx-0 lg:my-0.5 lg:h-px lg:w-5" aria-hidden />
        {locked ? (
          <span className={`${tool} cursor-help`} title="It has responses, so it can't be deleted" aria-label="Locked: it has responses">
            <Lock className="h-4 w-4" />
          </span>
        ) : (
          <button onClick={stop(onDelete)} className={`${tool} hover:!text-destructive`} aria-label="Delete" title="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
