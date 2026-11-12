import type React from 'react'
import { CornerDownRight, Flag, Plus } from 'lucide-react'
import type { BlockDropTarget, DragPayload } from '../../email-builder/hooks/useBlockDrag'
import type { SurveyBlock, SurveyBlockType, SurveyDesign, SurveySettings } from '../types'
import { describePageRouteParts } from '../logic/describe'
import { SurveyStyles, mix } from '../runtime/questions'
import { cardStyle } from '../runtime/SurveyRenderer'
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
  onOpenSettings: () => void
  /** The thank-you, drawn after the last page. */
  thankYou: SurveySettings['thankYou']
  onDuplicate: (block: SurveyBlock, pageId: string, index: number) => void
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
  onOpenSettings,
  thankYou,
  onDuplicate,
}: SurveyCanvasProps) {
  const { theme } = design

  return (
    <div
      data-canvas-scroll
      className="flex-1 flex items-start justify-center bg-background px-2 pt-2 pb-24 lg:px-8 lg:pt-6 lg:pb-10 min-h-[calc(100dvh-64px)] overflow-y-auto"
      onClick={() => setSelectedBlockId(null)}
    >
      <SurveyStyles theme={theme} />
      <div
        // The survey's own page, framed on the app's surface, so it reads as what respondents see in both themes.
        className="sv-root w-full flex flex-col gap-7 origin-top rounded-2xl border border-border shadow-sm transition-all duration-300"
        style={{
          maxWidth: previewMode === 'desktop' ? `${theme.bodyWidth + 96}px` : '407px',
          padding: previewMode === 'desktop' ? '32px 48px 40px' : '20px 16px 32px',
          background: theme.bgImage ? `${theme.pageBgColor} url(${JSON.stringify(theme.bgImage)}) center/cover` : theme.pageBgColor,
          zoom: zoomLevel,
          fontFamily: theme.fontFamily,
          lineHeight: theme.lineHeight,
          color: theme.textColor,
        }}
      >
        {design.pages.map((page, pageIndex) => {
          const isSelectedPage = page.id === selectedPageId
          const routes = describePageRouteParts(design, pageIndex)
          // The page gets a ring only when it is what's selected; a selected question has its own.
          const pageRing = isSelectedPage && !page.blocks.some(b => b.id === selectedBlockId)
          return (
            <div key={page.id} data-page-id={page.id} onClick={e => (e.stopPropagation(), setSelectedPageId(page.id), setSelectedBlockId(null))}>
              <div className="mb-2 flex items-center justify-between gap-3 px-1 font-sans">
                <span className="flex min-w-0 items-center gap-2 text-[13px]" style={{ color: isSelectedPage ? theme.textColor : mix(theme.textColor, 0.68) }}>
                  <span
                    className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums"
                    style={{ background: isSelectedPage ? theme.accentColor : mix(theme.textColor, 0.1), color: isSelectedPage ? theme.buttonTextColor : theme.textColor }}
                  >
                    {pageIndex + 1}
                  </span>
                  <span className="truncate font-semibold">{page.title || `Page ${pageIndex + 1}`}</span>
                  {pageRing && (
                    <span className="shrink-0 rounded-full px-2 py-px text-xs font-medium" style={{ background: mix(theme.accentColor, 0.12), color: theme.textColor }}>
                      Adding here
                    </span>
                  )}
                </span>
              </div>
              <div
                data-canvas-body
                data-block-count={page.blocks.length}
                className="relative transition-shadow"
                style={{
                  ...cardStyle(theme),
                  maxWidth: undefined,
                  boxShadow: pageRing ? `0 0 0 2px ${mix(theme.accentColor, 0.6)}` : cardStyle(theme).boxShadow,
                }}
              >
                {theme.logoUrl && pageIndex === 0 && (
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <img src={theme.logoUrl} alt="" style={{ maxHeight: 40 }} />
                  </div>
                )}
                {theme.showProgressBar && design.pages.length > 1 && (
                  <div className="pointer-events-none" aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                    <div style={{ flex: 1, height: 6, background: mix(theme.textColor, 0.1), borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${((pageIndex + 1) / design.pages.length) * 100}%`, background: theme.accentColor, borderRadius: 999 }} />
                    </div>
                    <span style={{ fontSize: 13, opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                      Page {pageIndex + 1} of {design.pages.length}
                    </span>
                  </div>
                )}
                {page.blocks.length === 0 ? (
                  <div
                    className="h-32 border-2 border-dashed rounded-lg flex items-center justify-center text-center text-xs p-4 select-none font-sans"
                    style={{ borderColor: mix(theme.textColor, 0.15), color: mix(theme.textColor, 0.5) }}
                  >
                    Drag a question here, or pick one on the left
                  </div>
                ) : (
                  <div className="flex flex-col" style={{ gap: 12 }}>
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
                          onDuplicate={() => onDuplicate(block, page.id, index + 1)}
                          startDrag={startDrag}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {!!dragging && dropTarget?.pageId === page.id && dropTarget.index === page.blocks.length && page.blocks.length > 0 && (
                  <div className="h-0.5 bg-accent rounded-full pointer-events-none mt-1" />
                )}
                <div className="flex justify-end gap-3 pointer-events-none select-none" aria-hidden style={{ marginTop: 28 }}>
                  <span
                    style={{
                      padding: '11px 22px',
                      fontSize: 15,
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
              {routes.length > 0 && (
                <div className="mt-2 flex flex-col gap-1 rounded-md border-l-[3px] py-2 pl-3 pr-2 font-sans text-[13px]" style={{ borderColor: theme.accentColor, background: theme.cardBgColor, color: theme.textColor }}>
                  {routes.map((r, i) => (
                    <span key={i} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <CornerDownRight className="h-3.5 w-3.5 shrink-0" style={{ color: theme.accentColor }} aria-hidden />
                      <button type="button" onClick={e => (e.stopPropagation(), onOpenLogic())} className="cursor-pointer text-left hover:underline" title="Change it in Logic">
                        {r.lead}
                      </button>
                      {r.pageId ? (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            document.querySelector(`[data-page-id="${r.pageId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                            setSelectedPageId(r.pageId!)
                            setSelectedBlockId(null)
                          }}
                          className="cursor-pointer rounded-full px-2 py-px font-medium transition-colors"
                          style={{ background: mix(theme.accentColor, 0.12) }}
                          title="Go to that page"
                        >
                          {r.target}
                        </button>
                      ) : (
                        <span className="rounded-full px-2 py-px font-medium" style={{ background: mix(theme.textColor, 0.08) }}>
                          {r.target}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <button
          onClick={e => {
            e.stopPropagation()
            dispatch('survey.addPage', { page: { blocks: [] } })
          }}
          className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border-2 border-dashed font-sans text-sm font-medium transition-colors hover:brightness-95"
          style={{ borderColor: mix(theme.textColor, 0.22), color: mix(theme.textColor, 0.75), background: 'transparent' }}
        >
          <Plus className="h-4 w-4" aria-hidden /> Add a page
        </button>
        {/* What people see once they've sent the last page. */}
        <div onClick={e => (e.stopPropagation(), onOpenSettings())} className="cursor-pointer" title="Change it in Settings">
          <div className="mb-2 flex items-center gap-2 px-1 font-sans text-[13px] font-semibold" style={{ color: mix(theme.textColor, 0.68) }}>
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full" style={{ background: mix(theme.textColor, 0.1), color: theme.textColor }}>
              <Flag className="h-3 w-3" aria-hidden />
            </span>
            When they finish
          </div>
          <div style={{ ...cardStyle(theme), maxWidth: undefined, textAlign: 'center', paddingTop: 40, paddingBottom: 40 }}>
            {theme.logoUrl && <img src={theme.logoUrl} alt="" style={{ maxHeight: 40, marginBottom: 16 }} />}
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.25, marginBottom: 8 }}>{thankYou.title}</div>
            <div style={{ opacity: 0.8, whiteSpace: 'pre-wrap' }}>{thankYou.message}</div>
          </div>
        </div>

      </div>
    </div>
  )
}
