import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, X } from 'lucide-react'
import { queryKeys } from '../../queryKeys'
import { getContactFieldsFn, publishSurveyFn, updateSurveyFn } from '../../server/functions'
import { useIsDesktop } from '../../hooks/useMediaQuery'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { Sheet } from '../../components/ui/Sheet'
import { Dialog } from '../../components/ui/Dialog'
import { AIChat } from '../copilot/components/AIChat'
import { useBlockDrag, type BlockDropTarget, type DragPayload } from '../email-builder/hooks/useBlockDrag'
import type { Survey, SurveyBlockType, SurveyDesign, SurveySettings } from './types'
import { isQuestionType } from './types'
import { applySurveyBuilderAction, checkStructureLock, findBlock, newBlockId } from './applyAction'
import { lintSurvey } from './logic/lint'
import { SURVEY_STARTER_TEMPLATES, type SurveyStarterTemplate } from './templates/starters'
import { createSurveyBlock } from './templates/blocks'
import { SurveyBuilderHeader } from './components/SurveyBuilderHeader'
import { SurveySidebarMenu, type SurveyMenu } from './components/SurveySidebarMenu'
import { SurveySidebarPanel, type SurveyContentTab } from './components/SurveySidebarPanel'
import { SurveyCanvas } from './components/SurveyCanvas'
import { SurveyRenderer } from './runtime/SurveyRenderer'

export interface SurveyBuilderProps {
  survey: Survey & { responseCount: number }
  onClose: () => void
  onSaved: (survey: Survey) => void
}

type Snapshot = { name: string; design: SurveyDesign; settings: SurveySettings }

function lockedIds(design: SurveyDesign) {
  const blocks = new Set<string>()
  const options = new Set<string>()
  for (const page of design.pages) {
    for (const b of page.blocks) {
      if (!isQuestionType(b.type)) continue
      blocks.add(b.id)
      b.question?.options?.forEach(o => options.add(o.id))
    }
  }
  return { blocks, options }
}

/**
 * The survey design builder. Same layout and state shape as `EmailBuilder`:
 * header, icon rail, side panel, canvas, copilot aside. Every design edit goes
 * through the shared `applySurveyBuilderAction` reducer, the same one the
 * copilot's server-side copy of the design uses.
 */
export function SurveyBuilder({ survey, onClose, onSaved }: SurveyBuilderProps) {
  const [name, setName] = useState(survey.name)
  const [status, setStatus] = useState(survey.status)
  const [design, setDesignState] = useState<SurveyDesign>(survey.design)
  const [settings, setSettingsState] = useState<SurveySettings>(survey.settings)

  // A ref mirror lets several actions in one tick (copilot batches) chain on
  // each other instead of all starting from the same stale render.
  const designRef = useRef(design)
  const setDesign = (next: SurveyDesign) => {
    designRef.current = next
    setDesignState(next)
  }

  const savedRef = useRef(JSON.stringify({ name: survey.name, design: survey.design, settings: survey.settings } satisfies Snapshot))
  // Once real responses exist, everything in the last saved design is locked.
  const hasResponses = survey.responseCount > 0
  const [lockBase, setLockBase] = useState<SurveyDesign | null>(hasResponses ? survey.design : null)
  const locked = useMemo(() => (lockBase ? lockedIds(lockBase) : { blocks: new Set<string>(), options: new Set<string>() }), [lockBase])

  const [activeMenu, setActiveMenu] = useState<SurveyMenu>('content')
  const [contentTab, setContentTab] = useState<SurveyContentTab>('blocks')
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(survey.design.pages[0]?.id ?? null)
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [showPreview, setShowPreview] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const { width: chatWidth, isResizing: isChatResizing, startResizing } = useResizablePanel()
  const isDesktop = useIsDesktop()

  const { data: contactFields = [] } = useQuery({ queryKey: queryKeys.email.contactFields(), queryFn: () => getContactFieldsFn() })
  const issues = useMemo(() => lintSurvey(design, settings, contactFields), [design, settings, contactFields])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  useEffect(() => {
    if (!isDesktop && selectedBlockId) setIsPanelOpen(true)
  }, [selectedBlockId, isDesktop])

  // Keep a valid page selected as pages come and go.
  useEffect(() => {
    if (!design.pages.some(p => p.id === selectedPageId)) setSelectedPageId(design.pages[0]?.id ?? null)
  }, [design.pages, selectedPageId])

  // Auto zoom the canvas to fit, as the email builder does.
  useEffect(() => {
    const handleResize = () => {
      const left = isDesktop ? 64 + 320 : 0
      const right = isDesktop && isChatOpen ? chatWidth : 0
      const available = window.innerWidth - left - right - (isDesktop ? 30 : 16)
      const target = previewMode === 'desktop' ? design.theme.bodyWidth : 375
      setZoomLevel(Math.max(0.4, Math.min(1.5, (available / target) * 0.92)))
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [design.theme.bodyWidth, previewMode, isChatOpen, chatWidth, isDesktop])

  /** Apply one design action, refusing edits that would break the structure lock. */
  const dispatch = useCallback(
    (action: string, args: any) => {
      const next = applySurveyBuilderAction(designRef.current, { action, args })
      if (lockBase) {
        const violation = checkStructureLock(lockBase, next)
        if (violation) {
          setNotice(violation)
          return false
        }
      }
      setDesign(next)
      return true
    },
    [lockBase],
  )

  const setSettings = (updates: Partial<SurveySettings>) => setSettingsState(prev => ({ ...prev, ...updates }))

  const addBlock = (type: SurveyBlockType, pageId = selectedPageId ?? design.pages[0]?.id, index?: number) => {
    const block = createSurveyBlock(type)
    if (dispatch('survey.addBlock', { pageId, index, block })) {
      setSelectedPageId(pageId ?? null)
      setSelectedBlockId(block.id)
      setActiveMenu('content')
    }
  }

  const handleDrop = useCallback(
    (payload: DragPayload<SurveyBlockType>, target: BlockDropTarget) => {
      const pageId = target.pageId
      if (!pageId) return
      if (payload.kind === 'new') {
        addBlock(payload.blockType, pageId, target.index)
        return
      }
      const fromPage = designRef.current.pages.find(p => p.id === payload.pageId)
      const block = fromPage?.blocks[payload.index]
      if (!block) return
      // Removing the block first shifts later indexes on the same page down by one.
      const index = payload.pageId === pageId && target.index > payload.index ? target.index - 1 : target.index
      dispatch('survey.moveBlock', { id: block.id, toPageId: pageId, index })
    },
    // addBlock only reads refs and stable setters besides dispatch.
    [dispatch],
  )
  const { startDrag, dragging, dropTarget, didDrag } = useBlockDrag<SurveyBlockType>(handleDrop)

  const applyTemplate = (template: SurveyStarterTemplate) => {
    const hasContent = design.pages.some(p => p.blocks.length > 0)
    if (hasContent && !window.confirm(`Replace every page with "${template.name}"?`)) return
    if (dispatch('survey.applyTemplate', { pages: template.build(), theme: template.theme })) setSelectedBlockId(null)
  }

  const snapshot = (): Snapshot => ({ name, design, settings })
  const isDirty = JSON.stringify(snapshot()) !== savedRef.current

  const saveMutation = useMutation({
    mutationFn: (sent: Snapshot) => updateSurveyFn({ data: { id: survey.id, ...sent } }),
    onSuccess: (saved, sent) => {
      // Compare against what was sent, not the server's copy: validation can
      // reorder keys, which would otherwise read as "unsaved changes".
      savedRef.current = JSON.stringify(sent)
      if (lockBase) setLockBase(saved.design)
      setNotice(null)
      onSaved(saved)
    },
    onError: (err: Error) => setNotice(err.message),
  })

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (isDirty) await saveMutation.mutateAsync(snapshot())
      return publishSurveyFn({ data: { id: survey.id } })
    },
    onSuccess: saved => {
      setStatus(saved.status)
      setNotice(null)
      onSaved(saved)
    },
    onError: (err: Error) => setNotice(err.message),
  })

  const handleRequestClose = () => {
    if (isDirty && !window.confirm('You have unsaved changes. Leave without saving?')) return
    onClose()
  }

  /** Apply mutations streamed back by the copilot. */
  const applyCopilotActions = (actions: Array<{ action: string; args: any }>) => {
    for (const incoming of actions) {
      // Pin the id up front so the same block id ends up in state and in the selection.
      const action =
        incoming.action === 'survey.addBlock'
          ? { ...incoming, args: { ...incoming.args, block: { ...incoming.args?.block, id: incoming.args?.block?.id ?? newBlockId() } } }
          : incoming
      const ok = dispatch(action.action, action.args)
      if (!ok) continue
      if (action.action === 'survey.addBlock') {
        setSelectedBlockId(action.args.block.id)
      } else if (action.action === 'survey.deleteBlock') {
        setSelectedBlockId(prev => (prev === action.args.id ? null : prev))
      } else if (['survey.applyTemplate', 'survey.replacePages', 'survey.restoreDesign'].includes(action.action)) {
        setSelectedBlockId(null)
      }
    }
  }

  const selectedBlock = selectedBlockId ? findBlock(design, selectedBlockId)?.block : undefined
  const errorCount = issues.filter(i => i.level === 'error').length

  const panel = (
    <SurveySidebarPanel
      activeMenu={activeMenu}
      contentTab={contentTab}
      setContentTab={setContentTab}
      design={design}
      settings={settings}
      setSettings={setSettings}
      dispatch={dispatch}
      selectedBlock={selectedBlock}
      setSelectedBlockId={setSelectedBlockId}
      selectedPageId={selectedPageId}
      setSelectedPageId={setSelectedPageId}
      addBlock={type => addBlock(type)}
      templates={SURVEY_STARTER_TEMPLATES}
      applyTemplate={applyTemplate}
      startDrag={startDrag}
      didDrag={didDrag}
      lockedBlockIds={locked.blocks}
      lockedOptionIds={locked.options}
      contactFields={contactFields}
      issues={issues}
    />
  )

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col z-55 animate-in fade-in duration-200">
      <SurveyBuilderHeader
        name={name}
        setName={setName}
        status={status}
        previewMode={previewMode}
        setPreviewMode={setPreviewMode}
        onClose={handleRequestClose}
        onSave={() => saveMutation.mutate(snapshot())}
        onPublish={() => publishMutation.mutate()}
        onPreview={() => setShowPreview(true)}
        isSaving={saveMutation.isPending || publishMutation.isPending}
        isDirty={isDirty}
        isChatOpen={isChatOpen}
        setIsChatOpen={setIsChatOpen}
      />

      {notice && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs px-4 py-2 flex items-start gap-2 shrink-0">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <span className="flex-1 whitespace-pre-line">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0 overflow-y-auto custom-scrollbar">
        <SurveySidebarMenu
          activeMenu={activeMenu}
          setActiveMenu={setActiveMenu}
          setSelectedBlockId={setSelectedBlockId}
          onSelect={() => setIsPanelOpen(true)}
          logicIssueCount={errorCount}
        />

        {isDesktop ? (
          panel
        ) : (
          <Sheet
            isOpen={isPanelOpen}
            onClose={() => setIsPanelOpen(false)}
            title={selectedBlock ? 'Edit block' : activeMenu[0].toUpperCase() + activeMenu.slice(1)}
            className="h-[75dvh]"
          >
            {panel}
          </Sheet>
        )}

        <SurveyCanvas
          design={design}
          previewMode={previewMode}
          zoomLevel={zoomLevel}
          selectedBlockId={selectedBlockId}
          setSelectedBlockId={setSelectedBlockId}
          selectedPageId={selectedPageId}
          setSelectedPageId={setSelectedPageId}
          dispatch={dispatch}
          dragging={dragging}
          dropTarget={dropTarget}
          startDrag={startDrag}
          lockedBlockIds={locked.blocks}
          onOpenLogic={() => {
            setActiveMenu('logic')
            setIsPanelOpen(true)
          }}
        />

        {isChatOpen && (
          <aside
            style={{
              width: isDesktop ? `${chatWidth}px` : undefined,
              transition: isChatResizing ? 'none' : 'width 300ms cubic-bezier(0.2, 0, 0, 1)',
            }}
            className="border-border bg-card flex flex-col fixed inset-0 z-50 lg:static lg:z-10 lg:border-l lg:shrink-0 lg:h-[calc(100dvh-64px)] lg:sticky lg:top-0 relative"
          >
            <div
              onPointerDown={startResizing}
              className="w-3 -left-1.5 cursor-col-resize absolute top-0 bottom-0 select-none z-50 hidden lg:flex items-center justify-center group touch-none"
            >
              <div className={`w-[2px] h-full transition-colors duration-150 ${isChatResizing ? 'bg-primary' : 'bg-transparent group-hover:bg-muted-foreground/30'}`} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col h-full">
              <AIChat
                onClose={() => setIsChatOpen(false)}
                pageContext={`/marketing/surveys/${survey.id}/edit`}
                surveyBuilderContext={{
                  survey: { id: survey.id, name, status, hasResponses },
                  pages: design.pages,
                  theme: design.theme as unknown as Record<string, unknown>,
                  selectedPageId,
                  selectedBlockId,
                }}
                onSurveyBuilderAction={applyCopilotActions}
              />
            </div>
          </aside>
        )}

        {isChatResizing && <div style={{ cursor: 'col-resize' }} className="fixed inset-0 z-[9999] pointer-events-auto select-none" />}
      </div>

      <Dialog isOpen={showPreview} onClose={() => setShowPreview(false)} title="Preview" className="max-w-4xl">
        <p className="text-xs text-muted-foreground mb-3">Logic and validation run as they will for respondents. Nothing is saved.</p>
        <div className="rounded-lg overflow-hidden border border-border max-h-[70vh] overflow-y-auto">
          {/* Remount per open so every preview starts from page one. */}
          {showPreview && <SurveyRenderer design={design} settings={settings} />}
        </div>
      </Dialog>
    </div>
  )
}
