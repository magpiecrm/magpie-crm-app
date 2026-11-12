import type React from 'react'
import { useEffect, useState } from 'react'
import { QuestionPicker } from './QuestionPicker'
import { CheckCircle2, CornerDownRight, Plus } from 'lucide-react'
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
  /** Add a question or content block at a place on a page, from a "+" between blocks. */
  onInsert: (type: SurveyBlockType, pageId: string, index: number) => void
  /** The Add tab is open, so mark the page where a picked question will go. */
  showAddTarget: boolean
}

type Spot = { pageId: string; index: number }

/**
 * A "+" in the gap above a block (or after the last), shown on hover; it opens
 * the question picker there, and what's picked goes in at that spot.
 */
function InsertPoint({ at, open, setOpen, onPick }: { at: Spot; open: Spot | null; setOpen: (s: Spot | null) => void; onPick: (type: SurveyBlockType) => void }) {
  const isOpen = open?.pageId === at.pageId && open.index === at.index
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, setOpen])
  return (
    <div className="group/insert absolute inset-x-0 -top-[13px] z-10 flex h-3 items-center justify-center font-sans" onClick={e => e.stopPropagation()}>
      <span aria-hidden className={`pointer-events-none absolute inset-x-6 top-1/2 h-px bg-accent/50 ${isOpen ? 'opacity-100' : 'opacity-0 group-hover/insert:opacity-100'}`} />
      <button
        type="button"
        onClick={() => setOpen(isOpen ? null : at)}
        aria-label="Add a question here"
        aria-expanded={isOpen}
        title="Add a question here"
        className={`relative inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-accent/60 bg-card text-accent shadow-sm transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
          isOpen ? 'opacity-100' : 'opacity-0 group-hover/insert:opacity-100'
        }`}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {isOpen && (
        <div role="dialog" aria-label="Add a question here" className="absolute left-1/2 top-5 z-40 max-h-[min(30rem,calc(100dvh-14rem))] w-[22rem] -translate-x-1/2 overflow-y-auto rounded-md-m border border-border bg-popover p-3 text-foreground shadow-xl custom-scrollbar">
          <QuestionPicker
            autoFocus
            onPick={type => {
              onPick(type)
              setOpen(null)
            }}
          />
        </div>
      )}
    </div>
  )
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
  onInsert,
  showAddTarget,
}: SurveyCanvasProps) {
  const { theme } = design
  const [picker, setPicker] = useState<Spot | null>(null)

  return (
    <div
      data-canvas-scroll
      className="flex-1 flex items-start justify-center bg-background px-2 pt-2 pb-24 lg:px-8 lg:pt-6 lg:pb-10 min-h-[calc(100dvh-64px)] overflow-y-auto"
      onClick={() => (setSelectedBlockId(null), setPicker(null))}
    >
      <SurveyStyles theme={theme} />
      <div
        // The builder's own desk, in the app's colours; only the survey's cards take the survey's look,
        // so nothing glares in a dark app. Its page background shows in Preview and in Style.
        className="sv-root w-full flex flex-col gap-7 origin-top transition-all duration-300"
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
          const routes = describePageRouteParts(design, pageIndex)
          // The page gets a ring only when it is what's selected; a selected question has its own.
          const pageRing = isSelectedPage && !page.blocks.some(b => b.id === selectedBlockId)
          return (
            <div key={page.id} data-page-id={page.id} onClick={e => (e.stopPropagation(), setSelectedPageId(page.id), setSelectedBlockId(null))}>
              <div className="mb-2 flex items-center justify-between gap-3 px-1 font-sans">
                <span className={`flex min-w-0 items-center gap-2 text-sm ${isSelectedPage ? 'text-foreground' : 'text-muted-foreground'}`}>
                  <span
                    className={`inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${
                      isSelectedPage ? 'bg-accent text-accent-foreground' : 'bg-foreground/[0.08] text-foreground'
                    }`}
                  >
                    {pageIndex + 1}
                  </span>
                  <span className="truncate font-semibold">{page.title || `Page ${pageIndex + 1}`}</span>
                  {pageRing && showAddTarget && <span className="shrink-0 rounded-full bg-accent/15 px-2 py-px text-xs font-medium text-foreground">New questions go here</span>}
                </span>
              </div>
              <div>
              <div
                data-canvas-body
                data-block-count={page.blocks.length}
                className="relative transition-shadow"
                style={{
                  ...cardStyle(theme),
                  maxWidth: undefined,
                  // The editor's own colour, never the survey's: a brand with a pale accent would lose it.
                  boxShadow: pageRing ? '0 0 0 2px var(--color-accent)' : cardStyle(theme).boxShadow,
                }}
              >
                {theme.logoUrl && (
                  <div style={{ textAlign: 'left', marginBottom: 20 }}>
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
                        className="relative"
                        style={theme.cardMode ? { border: `1px solid ${mix(theme.textColor, 0.1)}`, borderRadius: theme.cardRadius ?? 12, padding: '4px 16px' } : undefined}
                      >
                        {index > 0 && !dragging && block.id !== selectedBlockId && (
                          <InsertPoint at={{ pageId: page.id, index }} open={picker} setOpen={setPicker} onPick={type => onInsert(type, page.id, index)} />
                        )}
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
                          onEditText={text => dispatch('survey.updateBlock', { id: block.id, updates: block.question ? { question: { title: text } } : { content: text } })}
                          startDrag={startDrag}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {!!dragging && dropTarget?.pageId === page.id && dropTarget.index === page.blocks.length && page.blocks.length > 0 && (
                  <div className="h-0.5 bg-accent rounded-full pointer-events-none mt-1" />
                )}
                {!dragging && page.blocks.length > 0 && (
                  <div className="relative mt-3 h-0">
                    <InsertPoint at={{ pageId: page.id, index: page.blocks.length }} open={picker} setOpen={setPicker} onPick={type => onInsert(type, page.id, page.blocks.length)} />
                  </div>
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
              </div>
              {routes.length > 0 && (
                <div className="mt-2 flex flex-col gap-1 rounded-md border border-l-[3px] border-border border-l-accent bg-card py-2 pl-3 pr-2 font-sans text-[13px] text-foreground">
                  {routes.map((r, i) => (
                    <span key={i} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
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
                          className="cursor-pointer rounded-full bg-accent/10 px-2 py-px font-medium transition-colors hover:bg-accent/20"
                          title="Go to that page"
                        >
                          {r.target}
                        </button>
                      ) : (
                        <span className="rounded-full bg-foreground/[0.07] px-2 py-px font-medium">{r.target}</span>
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
          className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border font-sans text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add a page
        </button>
        {/* What people see once they've sent the last page. */}
        <div onClick={e => (e.stopPropagation(), onOpenSettings())} className="cursor-pointer" title="Change it in Settings">
          <div className="mb-2 flex items-center gap-2 px-1 font-sans text-sm font-semibold text-muted-foreground">
            <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-foreground/[0.08] text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            </span>
            At the end
          </div>
          <div>
          <div style={{ ...cardStyle(theme), maxWidth: undefined, textAlign: 'center', paddingTop: 40, paddingBottom: 40 }}>
            {theme.logoUrl && <img src={theme.logoUrl} alt="" style={{ maxHeight: 40, marginBottom: 16 }} />}
            <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.25, marginBottom: 8 }}>{thankYou.title}</div>
            <div style={{ opacity: 0.8, whiteSpace: 'pre-wrap' }}>{thankYou.message}</div>
          </div>
          </div>
        </div>

      </div>
    </div>
  )
}
