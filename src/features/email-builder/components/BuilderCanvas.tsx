import React from 'react'
import { Layout } from 'lucide-react'
import type { EmailBlock, GlobalStyle } from '../types'
import type { BlockDropTarget, DragPayload } from '../hooks/useBlockDrag'
import { BlockRenderer } from './BlockRenderer'

interface BuilderCanvasProps {
  globalStyle: GlobalStyle
  previewMode: 'desktop' | 'mobile'
  zoomLevel: number
  blocks: EmailBlock[]
  selectedBlockId: string | null
  setSelectedBlockId: (id: string | null) => void
  draggedIndex: number | null
  startDrag: (e: React.PointerEvent, payload: DragPayload) => void
  dropTarget: BlockDropTarget | null
  moveBlock: (id: string, direction: 'up' | 'down', e: React.MouseEvent) => void
  deleteBlock: (id: string, e: React.MouseEvent) => void
  handleImageResizeStart: (e: React.PointerEvent, blockId: string, currentHeight?: number) => void
  handleSpacerResizeStart: (e: React.PointerEvent, blockId: string, currentHeight: number) => void
  isResizing?: boolean
}

export function BuilderCanvas({
  globalStyle,
  previewMode,
  zoomLevel,
  blocks,
  selectedBlockId,
  setSelectedBlockId,
  draggedIndex,
  startDrag,
  dropTarget,
  moveBlock,
  deleteBlock,
  handleImageResizeStart,
  handleSpacerResizeStart,
  isResizing = false,
}: BuilderCanvasProps) {
  const cardMode = globalStyle.cardMode === true
  const cardGap = globalStyle.cardGap ?? 10
  const cardRadius = globalStyle.cardRadius ?? 5
  return (
    <div 
      data-canvas-scroll
      className="flex-1 dot-pattern text-slate-200 dark:text-slate-800/50 flex items-start justify-center p-2 lg:p-[15px] pb-20 lg:pb-[15px] min-h-[calc(100dvh-64px)] overflow-y-auto"
      style={{ backgroundColor: globalStyle.canvasBgColor }}
      onClick={() => setSelectedBlockId(null)}
    >
      <div 
        className={`w-full border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col my-4 origin-top ${
          isResizing ? 'transition-none' : 'transition-all duration-300'
        }`}
        style={{ 
          maxWidth: previewMode === 'desktop' ? `${globalStyle.bodyWidth}px` : '375px',
          minHeight: '800px',
          backgroundColor: cardMode ? 'transparent' : globalStyle.bodyBgColor,
          border: cardMode ? 'none' : undefined,
          boxShadow: cardMode ? 'none' : undefined,
          zoom: zoomLevel
        }}
      >
        {/* Content canvas blocks list */}
        <div
          data-canvas-body
          data-block-count={blocks.length}
          className="flex-1 relative"
          style={cardMode ? { display: 'flex', flexDirection: 'column', gap: `${cardGap}px` } : {
            backgroundColor: globalStyle.bodyBgColor,
            paddingLeft: `${globalStyle.paddingX}px`,
            paddingRight: `${globalStyle.paddingX}px`,
            paddingTop: `${globalStyle.paddingY}px`,
            paddingBottom: `${globalStyle.paddingY}px`
          }}
        >
          {blocks.length === 0 ? (
            <div className="h-64 border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center text-slate-400 p-4 text-center select-none m-4">
              <Layout className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm font-semibold">Canvas is empty</p>
              <p className="text-xs opacity-75">Add a block from the Content panel, or drag one in</p>
            </div>
          ) : (
            blocks.map((block, index) => {
              const rendered = (
                <BlockRenderer
                  key={block.id}
                  block={block}
                  index={index}
                  selectedBlockId={selectedBlockId}
                  setSelectedBlockId={setSelectedBlockId}
                  draggedIndex={draggedIndex}
                  globalStyle={globalStyle}
                  startDrag={startDrag}
                  showDropLine={dropTarget?.index === index}
                  moveBlock={moveBlock}
                  deleteBlock={deleteBlock}
                  handleImageResizeStart={handleImageResizeStart}
                  handleSpacerResizeStart={handleSpacerResizeStart}
                  blocksLength={blocks.length}
                  isResizing={isResizing}
                />
              )
              if (!cardMode) return rendered
              return (
                <div
                  key={block.id}
                  style={{
                    backgroundColor: globalStyle.bodyBgColor,
                    borderRadius: `${cardRadius}px`,
                    padding: `${globalStyle.paddingY}px ${globalStyle.paddingX}px`,
                  }}
                >
                  {rendered}
                </div>
              )
            })
          )}
          {/* Insertion indicator for a drop past the last block */}
          {dropTarget?.index === blocks.length && blocks.length > 0 && (
            <div className="h-0.5 bg-accent rounded-full pointer-events-none" />
          )}
          <div style={{ clear: 'both' }} />
        </div>
      </div>
    </div>
  )
}
