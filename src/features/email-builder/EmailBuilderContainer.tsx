import React, { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useBlockDrag, type DragPayload, type BlockDropTarget } from './hooks/useBlockDrag'
import { useIsDesktop } from '../../hooks/useMediaQuery'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { Sheet } from '../../components/ui/Sheet'
import { 
  Type, 
  FileText, 
  Image, 
  Play, 
  ExternalLink, 
  Database, 
  Sparkles, 
  Share2, 
  Code, 
  Minus, 
  ShoppingBag, 
  Compass, 
  Maximize2, 
  Layout,
  Newspaper,
  PanelBottom,
  ReceiptText,
  BellRing,
  Columns3,
  ClipboardList
} from 'lucide-react'

import { AIChat } from '../copilot/components/AIChat'
import { PreviewTestModal } from '../../components/PreviewTestModal'
import type { BlockType, EmailBlock, EmailBlockItem, EmailBuilderProps, EmailLink, EmailSocialLink, EmailSummaryRow, GlobalStyle } from './types'
import { BLOCK_TYPES } from './types'
import { applyBuilderAction, newBlockId } from './applyAction'
import { queryKeys } from '../../queryKeys'
import { getTemplatesFn } from '../../server/functions'
import type { EmailTemplate } from '../templates/types'

/**
 * Palette icons. The set of blocks itself comes from `BLOCK_TYPES` so the
 * palette cannot fall out of step with the block model — `columns` used to be
 * missing here entirely.
 */
const BLOCK_ICONS: Record<BlockType, React.ReactNode> = {
  title: <Type className="w-5 h-5" />,
  text: <FileText className="w-5 h-5" />,
  image: <Image className="w-5 h-5" />,
  video: <Play className="w-5 h-5" />,
  button: <ExternalLink className="w-5 h-5" />,
  dynamic: <Database className="w-5 h-5" />,
  logo: <Sparkles className="w-5 h-5" />,
  social: <Share2 className="w-5 h-5" />,
  html: <Code className="w-5 h-5" />,
  divider: <Minus className="w-5 h-5" />,
  product: <ShoppingBag className="w-5 h-5" />,
  articles: <Newspaper className="w-5 h-5" />,
  receipt: <ReceiptText className="w-5 h-5" />,
  notice: <BellRing className="w-5 h-5" />,
  navigation: <Compass className="w-5 h-5" />,
  footer: <PanelBottom className="w-5 h-5" />,
  spacer: <Maximize2 className="w-5 h-5" />,
  split: <Layout className="w-5 h-5" />,
  columns: <Columns3 className="w-5 h-5" />,
  section: <Layout className="w-5 h-5" />,
  survey: <ClipboardList className="w-5 h-5" />,
}

import { BuilderHeader } from './components/BuilderHeader'
import { SidebarMenu } from './components/SidebarMenu'
import { SidebarPanel } from './components/SidebarPanel'
import { BuilderCanvas } from './components/BuilderCanvas'
import { SaveTemplateDialog } from './components/SaveTemplateDialog'

import { STARTER_TEMPLATES, type StarterTemplate } from './templates/starters'
import { compileHTML } from './utils/compiler'
import { DEFAULT_GLOBAL_STYLE, extractDesign, loadDesign } from './utils/design'

const DEFAULT_BLOCKS: EmailBlock[] = []

export function EmailBuilder({
  initialHtml,
  onSave,
  onClose,
  campaignName,
  campaignSubject,
  campaignSender,
  campaignPreviewText,
  campaignId,
  template,
}: EmailBuilderProps) {
  const [blocks, setBlocks] = useState<EmailBlock[]>([])
  const [globalStyle, setGlobalStyle] = useState<GlobalStyle>(DEFAULT_GLOBAL_STYLE)

  /**
   * Snapshot of `{ blocks, globalStyle }` as last loaded or saved, compared
   * against the live state to ask "leave without saving?" on the back button.
   * A ref rather than state: it's written from inside the parsing effect using
   * locally-computed values (not read back from `blocks`/`globalStyle`, which
   * would still hold last render's value at that point), and reading it never
   * needs to trigger a re-render.
   */
  const savedSnapshotRef = React.useRef<string>(JSON.stringify({ blocks: DEFAULT_BLOCKS, globalStyle: DEFAULT_GLOBAL_STYLE }))

  const [activeMenu, setActiveMenu] = useState<'content' | 'style'>('content')
  const [contentTab, setContentTab] = useState<'blocks' | 'templates' | 'sections' | 'saved'>('blocks')
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const { data: savedTemplates } = useQuery({
    queryKey: queryKeys.templates.list(),
    queryFn: () => getTemplatesFn(),
  })
  const { width: chatWidth, isResizing: isChatResizing, startResizing } = useResizablePanel()
  const [isResizing, setIsResizing] = useState(false)
  const [resizeCursor, setResizeCursor] = useState<string | null>(null)
  const isDesktop = useIsDesktop()

  // On mobile the panel is a sheet, so selecting a block on the canvas has to
  // surface its editor; deselecting closes it again.
  useEffect(() => {
    if (isDesktop) return
    if (selectedBlockId) setIsPanelOpen(true)
  }, [selectedBlockId, isDesktop])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  // Auto zoom preview to fit workspace width
  useEffect(() => {
    const handleResize = () => {
      // Below lg the rails aren't in the layout — the menu is a bottom bar and
      // the panel is a sheet — so subtracting their widths would leave a
      // negative budget and peg the canvas at the minimum zoom.
      const leftSidebarWidth = isDesktop ? 64 + 320 : 0 // w-16 is 64px, w-80 is 320px
      const rightSidebarWidth = isDesktop && isChatOpen ? chatWidth : 0
      const paddingWidth = isDesktop ? 30 : 16
      const availableWidth = window.innerWidth - leftSidebarWidth - rightSidebarWidth - paddingWidth
      const targetWidth = previewMode === 'desktop' ? globalStyle.bodyWidth : 375
      const calculatedZoom = (availableWidth / targetWidth) * 0.92
      setZoomLevel(Math.max(0.4, Math.min(2.5, calculatedZoom)))
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [globalStyle.bodyWidth, previewMode, isChatOpen, chatWidth, isDesktop])

  // Parse state from HTML output, and record it as the "saved" baseline for
  // the unsaved-changes check below — using the loaded values directly, since
  // reading `blocks`/`globalStyle` back here would still see last render's
  // value, not what this effect is setting.
  useEffect(() => {
    const loaded = loadDesign(initialHtml)
    setBlocks(loaded.blocks)
    setGlobalStyle(loaded.globalStyle)
    savedSnapshotRef.current = JSON.stringify(loaded)
  }, [initialHtml])

  const handleSave = () => {
    const html = compileHTML(blocks, globalStyle)
    // The save succeeded from the builder's point of view — reset the
    // baseline so an immediate re-open of the back-button check (if the
    // parent ever kept the builder mounted after save) doesn't still think
    // there are unsaved changes.
    savedSnapshotRef.current = JSON.stringify({ blocks, globalStyle })
    onSave(html)
  }

  /**
   * Guards the builder's back button: if the live design differs from what
   * was last loaded or saved, confirm before discarding it. `window.confirm`
   * matches the pattern already used for destructive actions elsewhere in the
   * app (delete chat, delete campaign, delete list).
   */
  const handleRequestClose = () => {
    const current = JSON.stringify({ blocks, globalStyle })
    if (current !== savedSnapshotRef.current && !window.confirm('You have unsaved changes. Leave without saving?')) {
      return
    }
    onClose()
  }

  const createBlockTemplate = (type: EmailBlock['type']): EmailBlock => {
    let content = ''
    let url = ''
    let subContent = ''
    let subImage = ''
    let items: EmailBlockItem[] = []
    let children: EmailBlock[] | undefined
    let links: EmailLink[] | undefined
    let socials: EmailSocialLink[] | undefined
    let summaryRows: EmailSummaryRow[] | undefined

    switch (type) {
      case 'title': content = 'New Heading'; break
      case 'text': content = 'This is a standard text paragraph block. Double click or select to edit.'; break
      case 'image': content = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop'; break
      case 'video': content = 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop'; url = 'https://youtube.com'; break
      case 'button': content = 'Call to action'; url = 'https://example.com'; break
      case 'logo': content = 'MY BRAND'; break
      case 'dynamic': content = 'contact.FIRSTNAME'; break
      case 'html': content = '<div style="background-color: #f3f4f6; padding: 10px; border-radius: 4px; text-align: center;">Custom HTML Frame</div>'; break
      case 'spacer': content = '30'; break
      case 'divider': content = ''; break
      case 'social': content = ''; break
      case 'split': 
        content = 'Featured Topic'
        subContent = 'Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod.'
        subImage = 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=400&auto=format&fit=crop'
        url = 'https://example.com'
        break
      case 'receipt':
        content = 'Order summary'
        items = [
          { id: 'r1', image: '', title: 'Product with a longer name', text: '', qty: '2', price: '£19.00' },
          { id: 'r2', image: '', title: 'The second product', text: '', qty: '1', price: '£10.02' }
        ]
        summaryRows = [
          { id: 'sr1', label: 'VAT', value: '£0.00' },
          { id: 'sr2', label: 'Total', value: '£29.02', emphasis: true }
        ]
        break
      case 'notice':
        content = 'Details'
        items = [
          { id: 'n1', image: '', title: 'Delivery cancelled', text: 'Your order could not be completed and has been cancelled. Your account has not been charged.', badge: 'Alert', badgeColor: '#dc2626', url: '#' },
          { id: 'n2', image: '', title: 'Delivery complete', text: 'Your order has been delivered. Get in touch if anything is not right.', badge: 'Success', badgeColor: '#16a34a', url: '#' },
          { id: 'n3', image: '', title: 'Item dispatched', text: 'Your item left our warehouse and should reach you shortly.', badge: 'Info', badgeColor: '#2563eb', url: '#' }
        ]
        break
      case 'navigation':
        content = 'MY BRAND'
        url = 'https://example.com'
        links = [
          { id: 'nl1', label: 'Shop', url: '#' },
          { id: 'nl2', label: 'About', url: '#' },
          { id: 'nl3', label: 'Contact', url: '#' },
        ]
        break
      case 'footer':
        content = 'Your Company Ltd, 123 Example Street, London, EC1A 1BB'
        links = [
          { id: 'fl1', label: 'Unsubscribe', url: '{{ unsubscribe }}' },
          { id: 'fl2', label: 'Privacy', url: '#' },
        ]
        socials = [
          { id: 'fs1', label: 'Twitter', url: 'https://twitter.com' },
          { id: 'fs2', label: 'LinkedIn', url: 'https://linkedin.com' },
        ]
        break
      case 'articles':
        items = [
          { id: 'a1', image: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&auto=format&fit=crop', title: 'First article', text: 'A one-line summary that earns the click.', url: '#' },
          { id: 'a2', image: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=400&auto=format&fit=crop', title: 'Second article', text: 'A one-line summary that earns the click.', url: '#' }
        ]
        break
      case 'product':
        content = 'Buy now'
        items = [
          { id: 'p1', image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&auto=format&fit=crop', title: 'Heavyweight tee', text: 'Organic cotton', price: '£29.00', comparePrice: '£39.00', url: '#' },
          { id: 'p2', image: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&auto=format&fit=crop', title: 'Boxy crew', text: 'Loop-back sweat', price: '£65.00', url: '#' }
        ]
        break
      case 'columns':
        items = [
          { id: 'c1', image: 'https://images.unsplash.com/photo-1546182990-dffeafbe841d?w=200&auto=format&fit=crop', title: 'Feature One', text: 'Detail description text' },
          { id: 'c2', image: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200&auto=format&fit=crop', title: 'Feature Two', text: 'Detail description text' },
          { id: 'c3', image: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=200&auto=format&fit=crop', title: 'Feature Three', text: 'Detail description text' }
        ]
        break
      case 'survey':
        content = 'Take the survey'
        subContent = "We'd love your feedback — it takes less than a minute."
        break
      case 'section':
        children = [
          { id: 'sec_c1_' + Math.random().toString(36).substr(2, 6), type: 'title', content: 'Card heading' },
          { id: 'sec_c2_' + Math.random().toString(36).substr(2, 6), type: 'text', content: 'Card description text goes here.' }
        ]
        break
    }

    return {
      id: 'b_' + Math.random().toString(36).substr(2, 9),
      type,
      ...(type === 'survey' ? { surveyMode: 'button' as const, align: 'center' as const } : {}),
      content,
      url,
      subContent,
      subImage,
      items,
      links,
      socials,
      summaryRows,
      children
    }
  }

  const addBlock = (type: EmailBlock['type']) => {
    const newBlock = createBlockTemplate(type)
    setBlocks([...blocks, newBlock])
    setSelectedBlockId(newBlock.id)
  }

  /** Replacing the canvas discards whatever is on it, so confirm first when it isn't empty. */
  const applyTemplate = (template: StarterTemplate) => {
    if (blocks.length > 0 && !window.confirm(`Replace the current design with "${template.name}"? This discards the blocks on the canvas.`)) {
      return
    }
    setGlobalStyle(prev => ({ ...prev, ...template.globalStyle }))
    setBlocks(template.build())
    setSelectedBlockId(null)
  }

  const applySavedTemplate = (saved: EmailTemplate) => {
    const design = extractDesign(saved.html)
    if (!design) {
      window.alert(`"${saved.name}" has no editable design to apply.`)
      return
    }
    if (blocks.length > 0 && !window.confirm(`Replace the current design with "${saved.name}"? This discards the blocks on the canvas.`)) {
      return
    }
    setGlobalStyle(design.globalStyle)
    setBlocks(design.blocks)
    setSelectedBlockId(null)
  }

  const addSection = (sectionType: 'hero' | 'split' | 'features') => {
    let newBlocks: EmailBlock[] = []
    
    if (sectionType === 'hero') {
      newBlocks = [
        { id: 's_h1', type: 'image', content: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&auto=format&fit=crop' },
        { id: 's_h2', type: 'title', content: 'Design Something Beautiful' },
        { id: 's_h3', type: 'text', content: 'This template layout shows a full-width featured hero image followed by a header title, descriptive paragraph, and primary call-to-action button.' },
        { id: 's_h4', type: 'button', content: 'Get Started Today', url: '#' }
      ]
    } else if (sectionType === 'split') {
      newBlocks = [
        { 
          id: 's_s1', 
          type: 'split', 
          content: 'Split Article Layout',
          subContent: 'Clean side-by-side feature layout. Great for showcasing content summaries next to thumbnail preview images.',
          subImage: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&auto=format&fit=crop',
          url: '#'
        }
      ]
    } else if (sectionType === 'features') {
      newBlocks = [
        {
          id: 's_f1',
          type: 'columns',
          content: '',
          items: [
            { id: 'fi1', image: 'https://images.unsplash.com/photo-1472214222541-d510753a4907?w=200&auto=format&fit=crop', title: 'Ecosystem', text: 'Our clean global hosting system.' },
            { id: 'fi2', image: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=200&auto=format&fit=crop', title: 'Mountain', text: 'Premium visual assets library.' },
            { id: 'fi3', image: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=200&auto=format&fit=crop', title: 'Forestry', text: 'Sustainable code framework.' }
          ]
        }
      ]
    }

    setBlocks([...blocks, ...newBlocks])
  }

  const deleteBlock = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setBlocks(blocks.filter(b => b.id !== id))
    if (selectedBlockId === id) setSelectedBlockId(null)
  }

  const moveBlock = (id: string, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation()
    const index = blocks.findIndex(b => b.id === id)
    if (index === -1) return
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= blocks.length) return

    const updated = [...blocks]
    const temp = updated[index]
    updated[index] = updated[targetIndex]
    updated[targetIndex] = temp
    setBlocks(updated)
  }

  /**
   * Commit a pointer drag. Insert index and horizontal alignment both come from
   * where the pointer was released, matching the old HTML5 drop behaviour.
   */
  const handleBlockDrop = React.useCallback(
    (payload: DragPayload, target: BlockDropTarget) => {
      if (payload.kind === 'new') {
        const newBlock = createBlockTemplate(payload.blockType)
        newBlock.align = target.align
        setBlocks(prev => {
          const updated = [...prev]
          updated.splice(Math.min(target.index, updated.length), 0, newBlock)
          return updated
        })
        setSelectedBlockId(newBlock.id)
        return
      }

      setBlocks(prev => {
        const from = payload.index
        if (from < 0 || from >= prev.length) return prev
        // The removal shifts everything after `from` down by one.
        const to = target.index > from ? target.index - 1 : target.index
        if (to === from) {
          if (prev[from].align === target.align) return prev
          const same = [...prev]
          same[from] = { ...same[from], align: target.align }
          return same
        }
        const updated = [...prev]
        const [moved] = updated.splice(from, 1)
        updated.splice(Math.min(to, updated.length), 0, { ...moved, align: target.align })
        return updated
      })
    },
    [],
  )

  const { startDrag, dragging, dropTarget, didDrag } = useBlockDrag(handleBlockDrop)
  const draggedIndex = dragging?.kind === 'move' ? dragging.index : null

  const updateBlockContent = (id: string, updates: Partial<EmailBlock>) => {
    setBlocks(blocks.map(b => (b.id === id ? { ...b, ...updates } : b)))
  }

  const handleImageResizeStart = (e: React.PointerEvent, blockId: string, currentHeight?: number) => {
    e.preventDefault()
    e.stopPropagation()

    const resizeHandle = e.currentTarget as HTMLElement
    const contentContainer = resizeHandle.parentElement
    if (!contentContainer) return

    const contentRect = contentContainer.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY

    // Get the exact height of the content container (excluding block-wrapper padding)
    const startHeight = currentHeight || (contentRect.height / zoomLevel)
    // Current rendered width in CSS pixels (rect is in screen pixels, so unscale)
    const startWidthCss = contentRect.width / zoomLevel
    const currentBlock = blocks.find(b => b.id === blockId)

    // Available content width in CSS pixels, based on global settings
    const canvasWidth = previewMode === 'desktop' ? globalStyle.bodyWidth : 375
    const parentWidthCss = canvasWidth - (globalStyle.paddingX * 2)

    // Must mirror the wrapper CSS in BlockRenderer: only an explicit align of
    // 'center' centers the wrapper (margin auto), so it grows from both sides
    // and the right edge moves at half the width change — double the delta.
    // 'right' floats the wrapper right (left edge moves), everything else is
    // left-anchored and tracks the cursor 1:1.
    const align = currentBlock?.align
    const widthFactor = align === 'center' ? 2 : align === 'right' ? -1 : 1

    setResizeCursor('se-resize')
    setIsResizing(true)

    const handleMouseMove = (moveEvent: PointerEvent) => {
      const deltaX = (moveEvent.clientX - startX) / zoomLevel
      const newWidthCss = startWidthCss + deltaX * widthFactor
      const percentage = Math.max(10, Math.min(100, Math.round((newWidthCss / parentWidthCss) * 100)))

      // Adjust height delta by the current zoom level of the canvas
      const deltaY = (moveEvent.clientY - startY) / zoomLevel
      const newHeight = Math.max(30, Math.min(600, startHeight + deltaY))

      setBlocks(prev => prev.map(b => (
        b.id === blockId
          ? { ...b, width: `${percentage}%`, style: { ...b.style, height: newHeight } }
          : b
      )))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      setResizeCursor(null)
      document.removeEventListener('pointermove', handleMouseMove)
      document.removeEventListener('pointerup', handleMouseUp)
      document.removeEventListener('pointercancel', handleMouseUp)
    }

    document.addEventListener('pointermove', handleMouseMove)
    document.addEventListener('pointerup', handleMouseUp)
    document.addEventListener('pointercancel', handleMouseUp)
  }

  const handleSpacerResizeStart = (e: React.PointerEvent, blockId: string, currentHeight: number) => {
    e.preventDefault()
    e.stopPropagation()

    const startY = e.clientY
    const startHeight = currentHeight

    setResizeCursor('ns-resize')
    setIsResizing(true)

    const handleMouseMove = (moveEvent: PointerEvent) => {
      // Adjust height delta by the current zoom level of the canvas
      const deltaY = (moveEvent.clientY - startY) / zoomLevel
      const newHeight = Math.max(10, Math.min(200, startHeight + deltaY))
      setBlocks(prev => prev.map(b => (b.id === blockId ? { ...b, content: newHeight.toString() } : b)))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      setResizeCursor(null)
      document.removeEventListener('pointermove', handleMouseMove)
      document.removeEventListener('pointerup', handleMouseUp)
      document.removeEventListener('pointercancel', handleMouseUp)
    }

    document.addEventListener('pointermove', handleMouseMove)
    document.addEventListener('pointerup', handleMouseUp)
    document.addEventListener('pointercancel', handleMouseUp)
  }

  /**
   * Apply mutations streamed back by the copilot.
   *
   * Delegates to the shared reducer so the canvas and the copilot's server-side
   * view of the design stay identical — and so new actions (`applyTemplate`)
   * work here automatically instead of being silently dropped.
   *
   * `blocks` and `globalStyle` are separate pieces of state, but no action
   * derives one from the other, so the reducer can be run independently over
   * each half.
   */
  const applyBuilderActions = (actions: Array<{ action: string; args: any }>) => {
    for (const incoming of actions) {
      // Pin the id up front so the same block id ends up in state and in the
      // selection below.
      const action =
        incoming.action === 'addBlock'
          ? {
              ...incoming,
              args: {
                ...incoming.args,
                block: { ...incoming.args?.block, id: incoming.args?.block?.id ?? newBlockId() },
              },
            }
          : incoming

      setBlocks(prev => applyBuilderAction({ blocks: prev, globalStyle }, action).blocks)
      setGlobalStyle(prev => applyBuilderAction({ blocks: [], globalStyle: prev }, action).globalStyle)

      if (action.action === 'addBlock') {
        setSelectedBlockId(action.args.block.id)
      } else if (action.action === 'deleteBlock') {
        setSelectedBlockId(prev => (prev === action.args.id ? null : prev))
      } else if (
        action.action === 'applyTemplate' ||
        action.action === 'replaceBlocks' ||
        action.action === 'restoreDesign'
      ) {
        setSelectedBlockId(null)
      }
    }
  }

  const selectedBlock = blocks.find(b => b.id === selectedBlockId)

  const emailBlocksList = BLOCK_TYPES.map(b => ({
    type: b.type,
    label: b.label,
    icon: BLOCK_ICONS[b.type],
  }))

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col z-55 animate-in fade-in duration-200">
      
      <BuilderHeader 
        campaignName={template?.name ?? campaignName}
        badge={template ? 'Template' : 'Draft'}
        previewMode={previewMode}
        setPreviewMode={setPreviewMode}
        onClose={handleRequestClose}
        onSave={handleSave}
        onPreview={() => setShowPreviewModal(true)}
        onSaveAsTemplate={() => setShowSaveTemplate(true)}
        isChatOpen={isChatOpen}
        setIsChatOpen={setIsChatOpen}
      />

      {/* Main Dual Sidebar Layout Workspace */}
      <div className="flex-1 flex min-h-0 overflow-y-auto custom-scrollbar">
        
        <SidebarMenu 
          activeMenu={activeMenu}
          setActiveMenu={setActiveMenu}
          setSelectedBlockId={setSelectedBlockId}
          onSelect={() => setIsPanelOpen(true)}
        />

        {isDesktop ? (
          <SidebarPanel 
          activeMenu={activeMenu}
          contentTab={contentTab}
          setContentTab={setContentTab}
          selectedBlock={selectedBlock}
          setSelectedBlockId={setSelectedBlockId}
          globalStyle={globalStyle}
          setGlobalStyle={setGlobalStyle}
          updateBlockContent={updateBlockContent}
          addBlock={addBlock}
          addSection={addSection}
          templates={STARTER_TEMPLATES}
          savedTemplates={savedTemplates}
          applySavedTemplate={applySavedTemplate}
          onSaveAsTemplate={() => setShowSaveTemplate(true)}
          applyTemplate={applyTemplate}
          emailBlocksList={emailBlocksList}
          startDrag={startDrag}
          didDrag={didDrag}
          />
        ) : (
          <Sheet
            isOpen={isPanelOpen}
            // Keep the block selected: its canvas toolbar and resize handles are
            // only rendered while selected, and they are the touch resize affordance.
            onClose={() => setIsPanelOpen(false)}
            title={selectedBlock ? 'Edit block' : activeMenu === 'style' ? 'Style' : 'Content'}
            className="h-[75dvh]"
          >
            <SidebarPanel
              activeMenu={activeMenu}
              contentTab={contentTab}
              setContentTab={setContentTab}
              selectedBlock={selectedBlock}
              setSelectedBlockId={setSelectedBlockId}
              globalStyle={globalStyle}
              setGlobalStyle={setGlobalStyle}
              updateBlockContent={updateBlockContent}
              addBlock={addBlock}
              addSection={addSection}
              templates={STARTER_TEMPLATES}
              savedTemplates={savedTemplates}
              applySavedTemplate={applySavedTemplate}
              onSaveAsTemplate={() => setShowSaveTemplate(true)}
              applyTemplate={applyTemplate}
              emailBlocksList={emailBlocksList}
              startDrag={startDrag}
              didDrag={didDrag}
            />
          </Sheet>
        )}

        <BuilderCanvas 
          globalStyle={globalStyle}
          previewMode={previewMode}
          zoomLevel={zoomLevel}
          blocks={blocks}
          selectedBlockId={selectedBlockId}
          setSelectedBlockId={setSelectedBlockId}
          draggedIndex={draggedIndex}
          startDrag={startDrag}
          dropTarget={dropTarget}
          moveBlock={moveBlock}
          deleteBlock={deleteBlock}
          handleImageResizeStart={handleImageResizeStart}
          handleSpacerResizeStart={handleSpacerResizeStart}
          isResizing={isResizing}
        />

        {/* AI Copilot Chat Panel */}
        {isChatOpen && (
          <aside
            style={{
              width: isDesktop ? `${chatWidth}px` : undefined,
              transition: isChatResizing ? 'none' : 'width 300ms cubic-bezier(0.2, 0, 0, 1)'
            }}
            className="border-border bg-card flex flex-col fixed inset-0 z-50 lg:static lg:z-10 lg:border-l lg:shrink-0 lg:h-[calc(100dvh-64px)] lg:sticky lg:top-0 relative"
          >
            {/* Resize Handle (desktop only — the mobile panel is full-screen) */}
            <div
              onPointerDown={startResizing}
              className="w-3 -left-1.5 cursor-col-resize absolute top-0 bottom-0 select-none z-50 hidden lg:flex items-center justify-center group touch-none"
            >
              {/* Inner active indicator line */}
              <div className={`w-[2px] h-full transition-colors duration-150 ${
                isChatResizing ? 'bg-primary' : 'bg-transparent group-hover:bg-muted-foreground/30'
              }`} />
              
              {/* Visual grip handle */}
              <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-7 bg-card border border-border rounded-md shadow-sm flex flex-col items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 ${isChatResizing ? 'opacity-100 border-primary/50' : ''} transition-all duration-150 pointer-events-none z-50`}>
                <div className="w-1 h-1 bg-muted-foreground/60 rounded-full" />
                <div className="w-1 h-1 bg-muted-foreground/60 rounded-full" />
                <div className="w-1 h-1 bg-muted-foreground/60 rounded-full" />
              </div>
            </div>
            <div className="flex-1 min-w-0 flex flex-col h-full">
              <AIChat
                onClose={() => setIsChatOpen(false)}
                pageContext={template ? `/marketing/templates/${template.id}/edit` : '/marketing/campaigns/edit'}
                campaignContext={template ? undefined : {
                  id: campaignId || 0,
                  name: campaignName,
                  subject: campaignSubject,
                }}
                templateContext={template}
                builderContext={{ blocks, globalStyle, selectedBlockId }}
                onBuilderAction={applyBuilderActions}
              />
            </div>
          </aside>
        )}

        {/* Global drag overlay to capture mouse movements smoothly over iframes/canvas */}
        {(isResizing || isChatResizing) && (
          <div
            style={{ cursor: isChatResizing ? 'col-resize' : resizeCursor || 'default' }}
            className="fixed inset-0 z-[9999] pointer-events-auto select-none" 
          />
        )}

      </div>

      {/* Preview & Test Modal */}
      <PreviewTestModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        htmlContent={compileHTML(blocks, globalStyle)}
        campaignSubject={campaignSubject || ''}
        campaignSender={campaignSender || { name: '', email: '' }}
        campaignPreviewText={campaignPreviewText}
      />

      <SaveTemplateDialog
        // Remount per open so the name field restarts from the current design's name.
        key={String(showSaveTemplate)}
        isOpen={showSaveTemplate}
        onClose={() => setShowSaveTemplate(false)}
        getHtml={() => compileHTML(blocks, globalStyle)}
        defaultName={template ? `${template.name} (copy)` : campaignName}
      />

    </div>
  )
}
