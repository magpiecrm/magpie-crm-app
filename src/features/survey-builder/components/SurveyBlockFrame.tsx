import type React from 'react'
import { ArrowDown, ArrowUp, Copy, GripVertical, Lock, Trash2 } from 'lucide-react'
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
  onDuplicate: () => void
  startDrag: (e: React.PointerEvent, payload: DragPayload<SurveyBlockType>) => void
}

/**
 * Selection, toolbar and drag wrapper around one block on the canvas — the
 * survey counterpart of the email builder's `BlockRenderer`. The block itself
 * is drawn by the same `SurveyBlockView` respondents see.
 */
const tool =
  'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md-xs text-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent'

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
  onDuplicate,
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
      // Selected, it makes room above itself for its tools, so they never sit on its text or its neighbour's.
      style={selected ? { marginTop: 44 } : undefined}
      className={`relative group rounded-md outline-offset-[10px] transition-[outline-color,opacity] ${dragging ? 'opacity-40' : ''} ${
        selected ? 'outline-2 outline-solid outline-accent' : 'outline-1 outline-solid outline-transparent hover:outline-accent/45'
      }`}
    >
      {showDropLine && <div className="absolute -top-1 left-0 right-0 h-0.5 bg-accent rounded-full pointer-events-none z-10" />}

      {/* Inputs are visible but inert on the canvas; clicks select the block. */}
      <div className="pointer-events-none select-none">
        <SurveyBlockView block={block} theme={theme} disabled />
      </div>

      {/* Above the outline's top-right corner, in the room the block makes for it. */}
      <div
        className={`absolute -top-[54px] -right-[10px] z-20 flex-row items-center gap-0.5 rounded-md-s border border-border bg-popover p-0.5 font-sans text-foreground shadow-md ${
          selected ? 'flex' : 'hidden'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {locked && (
          <span className="mx-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground" title="People have answered it, so it can't change type or be deleted">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Has responses
          </span>
        )}
        <button
          onPointerDown={e => startDrag(e, { kind: 'move', index, pageId })}
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
        <button onClick={stop(onDuplicate)} className={tool} aria-label="Duplicate" title="Duplicate">
          <Copy className="h-4 w-4" />
        </button>
        <button
          onClick={stop(onDelete)}
          disabled={locked}
          className={`${tool} hover:!text-destructive`}
          aria-label="Delete"
          title={locked ? "It has responses, so it can't be deleted" : 'Delete'}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
