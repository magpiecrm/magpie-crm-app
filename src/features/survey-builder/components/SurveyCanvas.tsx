import type React from 'react'
import { GitBranch, Plus } from 'lucide-react'
import type { BlockDropTarget, DragPayload } from '../../email-builder/hooks/useBlockDrag'
import type { SurveyBlockType, SurveyDesign } from '../types'
import { mix } from '../runtime/questions'
import { SurveyBlockFrame } from './SurveyBlockFrame'
import type { Dispatch } from './SurveyBlockEditor'

interface SurveyCanvasProps {
  design: SurveyDesign
  previewMode: 'desktop' | 'mobile'
  zoomLevel: number
  selectedBlockId: string | null
  setSelectedBlockId: (id: string | null) => void
  selectedPageId: string | null
  setSelectedPageId: (id: string) => void
  dispatch: Dispatch
  dragging: DragPayload<SurveyBlockType> | null
  dropTarget: BlockDropTarget | null
  startDrag: (e: React.PointerEvent, payload: DragPayload<SurveyBlockType>) => void
  lockedBlockIds: Set<string>
  onOpenLogic: () => void
}

/** Every page stacked as its own card, so the whole survey is visible and editable at once. */
export function SurveyCanvas({
  design,
  previewMode,
  zoomLevel,
  selectedBlockId,
  setSelectedBlockId,
  selectedPageId,
  setSelectedPageId,
  dispatch,
  dragging,
  dropTarget,
  startDrag,
  lockedBlockIds,
  onOpenLogic,
}: SurveyCanvasProps) {
  const { theme } = design

  return (
    <div
      data-canvas-scroll
      className="flex-1 flex items-start justify-center p-2 lg:p-[15px] pb-20 lg:pb-[15px] min-h-[calc(100dvh-64px)] overflow-y-auto"
      style={{ background: theme.bgImage ? `${theme.pageBgColor} url(${JSON.stringify(theme.bgImage)}) center/cover` : theme.pageBgColor }}
      onClick={() => setSelectedBlockId(null)}
    >
      <div
        className="w-full flex flex-col gap-6 my-4 origin-top transition-all duration-300"
        style={{
          maxWidth: previewMode === 'desktop' ? `${theme.bodyWidth}px` : '375px',
          zoom: zoomLevel,
          fontFamily: theme.fontFamily,
          lineHeight: theme.lineHeight,
          color: theme.textColor,
        }}
      >
        {design.pages.map((page, pageIndex) => {
          const isSelectedPage = page.id === selectedPageId
          const ruleCount = page.rules?.length ?? 0
          const branches = ruleCount > 0 || (page.defaultNext && page.defaultNext.kind !== 'next')
          return (
            <div key={page.id} data-page-id={page.id} onClick={e => (e.stopPropagation(), setSelectedPageId(page.id), setSelectedBlockId(null))}>
              <div className="flex items-center justify-between mb-1.5 px-1 font-sans">
                <span className={`text-[11px] font-bold uppercase tracking-wider ${isSelectedPage ? 'text-accent' : 'text-muted-foreground'}`}>
                  {page.title || `Page ${pageIndex + 1}`}
                </span>
                {branches && (
                  <button
                    onClick={e => (e.stopPropagation(), onOpenLogic())}
                    className="flex items-center gap-1 text-[10px] font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded"
                  >
                    <GitBranch className="w-3 h-3" />
                    {ruleCount ? `${ruleCount} rule${ruleCount > 1 ? 's' : ''}` : 'Custom next'}
                  </button>
                )}
              </div>
              <div
                data-canvas-body
                data-block-count={page.blocks.length}
                className={`relative transition-shadow ${isSelectedPage ? 'ring-1 ring-accent/40' : ''}`}
                style={{
                  background: theme.cardBgColor,
                  borderRadius: theme.cardRadius ?? 12,
                  padding: '28px 24px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}
              >
                {page.blocks.length === 0 ? (
                  <div
                    className="h-32 border-2 border-dashed rounded-lg flex items-center justify-center text-center text-xs p-4 select-none font-sans"
                    style={{ borderColor: mix(theme.textColor, 0.15), color: mix(theme.textColor, 0.5) }}
                  >
                    Drop questions here, or pick one from the Content panel
                  </div>
                ) : (
                  <div className="flex flex-col" style={{ gap: theme.cardMode ? 12 : 4 }}>
                    {page.blocks.map((block, index) => (
                      <div
                        key={block.id}
                        style={theme.cardMode ? { border: `1px solid ${mix(theme.textColor, 0.1)}`, borderRadius: theme.cardRadius ?? 12, padding: '4px 16px' } : undefined}
                      >
                        <SurveyBlockFrame
                          block={block}
                          index={index}
                          pageId={page.id}
                          blocksLength={page.blocks.length}
                          theme={theme}
                          selected={block.id === selectedBlockId}
                          dragging={dragging?.kind === 'move' && dragging.pageId === page.id && dragging.index === index}
                          locked={lockedBlockIds.has(block.id)}
                          showDropLine={!!dragging && dropTarget?.pageId === page.id && dropTarget.index === index}
                          onSelect={() => {
                            setSelectedPageId(page.id)
                            setSelectedBlockId(block.id)
                          }}
                          onMove={direction => dispatch('survey.moveBlock', { id: block.id, direction })}
                          onDelete={() => {
                            dispatch('survey.deleteBlock', { id: block.id })
                            if (selectedBlockId === block.id) setSelectedBlockId(null)
                          }}
                          startDrag={startDrag}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {!!dragging && dropTarget?.pageId === page.id && dropTarget.index === page.blocks.length && page.blocks.length > 0 && (
                  <div className="h-0.5 bg-accent rounded-full pointer-events-none mt-1" />
                )}
                <div
                  className="flex justify-end gap-3 mt-6 pointer-events-none select-none"
                  aria-hidden
                  style={{ opacity: 0.6 }}
                >
                  <span
                    style={{
                      padding: '9px 18px',
                      fontSize: 14,
                      fontWeight: 600,
                      borderRadius: theme.buttonRadius,
                      background: theme.accentColor,
                      color: theme.buttonTextColor,
                    }}
                  >
                    {pageIndex === design.pages.length - 1 ? theme.submitLabel : theme.nextLabel}
                  </span>
                </div>
              </div>
            </div>
          )
        })}

        <button
          onClick={e => {
            e.stopPropagation()
            dispatch('survey.addPage', { page: { blocks: [] } })
          }}
          className="w-full py-3 border-2 border-dashed border-border rounded-xl text-xs font-semibold text-muted-foreground hover:text-accent hover:border-accent/50 flex items-center justify-center gap-1 font-sans bg-card/60"
        >
          <Plus className="w-4 h-4" /> Add page
        </button>
      </div>
    </div>
  )
}
