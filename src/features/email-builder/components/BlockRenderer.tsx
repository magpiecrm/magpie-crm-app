import React from 'react'
import { ArrowUp, ArrowDown, Trash2, GripVertical } from 'lucide-react'
import type { EmailBlock, GlobalStyle } from '../types'
import type { DragPayload } from '../hooks/useBlockDrag'
import { BLOCK_PADDING_DEFAULTS, resolvePadding } from '../utils/html'
import { renderSurveyInlineHtml } from '../../survey-builder/utils/emailSnippet'

/**
 * Canvas spacing is read from the same table the compiler uses, so the preview
 * and the sent email stay in step.
 */
function padding(block: EmailBlock): string {
  const [top, right, bottom, left] = resolvePadding(block.style, BLOCK_PADDING_DEFAULTS[block.type])
  return `${top}px ${right}px ${bottom}px ${left}px`
}

interface BlockRendererProps {
  block: EmailBlock
  index: number
  selectedBlockId: string | null
  setSelectedBlockId: (id: string | null) => void
  draggedIndex: number | null
  globalStyle: GlobalStyle
  startDrag: (e: React.PointerEvent, payload: DragPayload) => void
  /** Render the insertion indicator above this block. */
  showDropLine?: boolean
  moveBlock: (id: string, direction: 'up' | 'down', e: React.MouseEvent) => void
  deleteBlock: (id: string, e: React.MouseEvent) => void
  handleImageResizeStart: (e: React.PointerEvent, blockId: string, currentHeight?: number) => void
  handleSpacerResizeStart: (e: React.PointerEvent, blockId: string, currentHeight: number) => void
  blocksLength: number
  isResizing?: boolean
}

export function BlockRenderer({
  block,
  index,
  selectedBlockId,
  setSelectedBlockId,
  draggedIndex,
  globalStyle,
  startDrag,
  showDropLine = false,
  moveBlock,
  deleteBlock,
  handleImageResizeStart,
  handleSpacerResizeStart,
  blocksLength,
  isResizing = false,
}: BlockRendererProps) {
  const isWidthCustom = block.width && block.width !== '100%' && ['image', 'video', 'button', 'text', 'title'].includes(block.type)
  
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        setSelectedBlockId(block.id)
      }}
      data-block-index={index}
      className={`relative group rounded-md p-2 cursor-pointer block-wrapper-container ${
        isResizing ? 'transition-none' : 'transition-all duration-300'
      } ${
        selectedBlockId === block.id 
          ? 'ring-2 ring-accent bg-accent/5' 
          : 'hover:ring-1 hover:ring-slate-200 hover:bg-slate-50/50'
      } ${draggedIndex === index ? 'opacity-40 scale-[0.98] border border-dashed border-accent/40 bg-accent/5' : ''}`}
      style={{
        display: isWidthCustom 
          ? (block.align === 'center' ? 'block' : 'inline-block') 
          : 'block',
        width: isWidthCustom ? `calc(${block.width} + 16px)` : '100%',
        float: (isWidthCustom && block.align !== 'center') ? (block.align as any) : undefined,
        margin: (isWidthCustom && block.align === 'center') ? '0 auto' : undefined,
        clear: isWidthCustom 
          ? (block.align === 'center' ? 'both' : undefined) 
          : 'both'
      }}
    >
      {/* Hover controls bar */}
      {showDropLine && (
        <div className="absolute -top-0.5 left-0 right-0 h-0.5 bg-accent rounded-full z-20 pointer-events-none" />
      )}

      <div
        className={`absolute right-2 top-2 items-center gap-1 bg-card shadow-md border border-border p-1 rounded-md-xs z-10 select-none ${
          selectedBlockId === block.id ? 'flex' : 'hidden group-hover:flex touch-reveal'
        }`}
      >
        <div
          onPointerDown={(e) => startDrag(e, { kind: 'move', index })}
          onClick={(e) => e.stopPropagation()}
          className="p-2 cursor-grab active:cursor-grabbing touch-none text-muted-foreground hover:text-foreground border-r border-border flex items-center"
          title="Drag to reorder"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        <button 
          onClick={(e) => moveBlock(block.id, 'up', e)}
          disabled={index === 0}
          className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button 
          onClick={(e) => moveBlock(block.id, 'down', e)}
          disabled={index === blocksLength - 1}
          className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
        <button 
          onClick={(e) => deleteBlock(block.id, e)}
          className="p-1 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-500 rounded"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Core Block rendering engine */}
      {block.type === 'logo' && (
        <div
          className="font-extrabold uppercase tracking-tight select-text"
          style={{
            fontFamily: block.style?.fontFamily ?? globalStyle.fontFamily,
            textAlign: (block.align as any) || 'center',
            color: block.style?.color ?? '#111827',
            fontSize: block.style?.fontSize ? `${block.style.fontSize}px` : '20px',
            backgroundColor: block.style?.bgColor,
            padding: padding(block),
          }}
        >
          {isImageUrl(block.content) ? <LogoImage block={block} /> : block.content || 'LOGO'}
        </div>
      )}

      {block.type === 'title' && (
        <div 
          className="relative w-full"
          style={{ maxWidth: '100%' }}
        >
          <h1
            className="font-bold select-text outline-none"
            style={{
              fontFamily: block.style?.fontFamily ?? globalStyle.fontFamily,
              textAlign: block.style?.textAlign ?? (block.align as any) ?? 'left',
              color: block.style?.color ?? '#111827',
              fontSize: `${block.style?.fontSize ?? 24}px`,
              fontWeight: block.style?.fontWeight ?? 'bold',
              backgroundColor: block.style?.bgColor,
              padding: padding(block),
              lineHeight: 1.3,
              height: block.style?.height ? `${block.style.height}px` : undefined,
            }}
          >
            {block.content || 'Click to edit heading text'}
          </h1>
          {/* selection outline and resize handle */}
          {selectedBlockId === block.id && (
            <>
              <div className="absolute inset-0 border-2 border-accent/80 rounded pointer-events-none z-10" />
              <div 
                onPointerDown={(e) => handleImageResizeStart(e, block.id, block.style?.height)}
                className="absolute -right-1.5 -bottom-1.5 w-3.5 h-3.5 bg-accent hover:bg-accent/90 rounded-full border-2 border-white shadow-lg cursor-se-resize z-20 pointer-events-auto flex items-center justify-center transition-transform hover:scale-125 touch-none before:absolute before:-inset-3 before:content-['']"
                title="Drag to resize"
              >
                <span className="block w-1 h-1 bg-white rounded-full" />
              </div>
            </>
          )}
        </div>
      )}

      {block.type === 'text' && (
        <div 
          className="relative w-full"
          style={{ maxWidth: '100%' }}
        >
          <p
            className="whitespace-pre-wrap select-text outline-none"
            style={{
              fontFamily: block.style?.fontFamily ?? globalStyle.fontFamily,
              lineHeight: globalStyle.lineHeight,
              textAlign: block.style?.textAlign ?? (block.align as any) ?? 'left',
              color: block.style?.color ?? '#4b5563',
              fontSize: `${block.style?.fontSize ?? 15}px`,
              fontWeight: block.style?.fontWeight ?? 'normal',
              backgroundColor: block.style?.bgColor,
              padding: padding(block),
              height: block.style?.height ? `${block.style.height}px` : undefined,
            }}
          >
            {block.content || 'Click to edit text content'}
          </p>
          {/* selection outline and resize handle */}
          {selectedBlockId === block.id && (
            <>
              <div className="absolute inset-0 border-2 border-accent/80 rounded pointer-events-none z-10" />
              <div 
                onPointerDown={(e) => handleImageResizeStart(e, block.id, block.style?.height)}
                className="absolute -right-1.5 -bottom-1.5 w-3.5 h-3.5 bg-accent hover:bg-accent/90 rounded-full border-2 border-white shadow-lg cursor-se-resize z-20 pointer-events-auto flex items-center justify-center transition-transform hover:scale-125 touch-none before:absolute before:-inset-3 before:content-['']"
                title="Drag to resize"
              >
                <span className="block w-1 h-1 bg-white rounded-full" />
              </div>
            </>
          )}
        </div>
      )}

      {block.type === 'image' && (
        <div className={`select-none flex animate-in fade-in duration-100 ${
          block.align === 'left' ? 'justify-start' : block.align === 'right' ? 'justify-end' : 'justify-center'
        }`} style={{ padding: padding(block), width: '100%' }}>
          <div 
            className="relative group/img w-full"
            style={{ maxWidth: '100%' }}
          >
            <img 
              src={block.content || 'https://via.placeholder.com/600x300?text=Placeholder+Image'} 
              alt="Layout content" 
              className="w-full rounded object-cover pointer-events-none" 
              style={{ height: block.style?.height ? `${block.style.height}px` : undefined }}
            />
            {/* Visual selection outline and resize handle */}
            {selectedBlockId === block.id && (
              <>
                <div className="absolute inset-0 border-2 border-accent/80 rounded pointer-events-none z-10" />
                <div 
                  onPointerDown={(e) => handleImageResizeStart(e, block.id, block.style?.height)}
                  className="absolute -right-1.5 -bottom-1.5 w-3.5 h-3.5 bg-accent hover:bg-accent/90 rounded-full border-2 border-white shadow-lg cursor-se-resize z-20 pointer-events-auto flex items-center justify-center transition-transform hover:scale-125 touch-none before:absolute before:-inset-3 before:content-['']"
                  title="Drag to resize"
                >
                  <span className="block w-1 h-1 bg-white rounded-full" />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {block.type === 'video' && (
        <div style={{ textAlign: (block.align as any) || 'center', padding: padding(block), width: '100%' }}>
          <div 
            className="select-none relative bg-black rounded overflow-hidden inline-block w-full group/video"
            style={{ maxWidth: '100%' }}
          >
            <img 
              src={block.content || 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop'} 
              alt="Video Cover" 
              className="w-full opacity-85 object-cover animate-in fade-in" 
              style={{ height: block.style?.height ? `${block.style.height}px` : undefined }}
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/80 text-white w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold shadow-lg">▶</div>
            </div>
            {/* Visual selection outline and resize handle */}
            {selectedBlockId === block.id && (
              <>
                <div className="absolute inset-0 border-2 border-accent/80 rounded pointer-events-none z-10" />
                <div 
                  onPointerDown={(e) => handleImageResizeStart(e, block.id, block.style?.height)}
                  className="absolute -right-1.5 -bottom-1.5 w-3.5 h-3.5 bg-accent hover:bg-accent/90 rounded-full border-2 border-white shadow-lg cursor-se-resize z-20 pointer-events-auto flex items-center justify-center transition-transform hover:scale-125 touch-none before:absolute before:-inset-3 before:content-['']"
                  title="Drag to resize"
                >
                  <span className="block w-1 h-1 bg-white rounded-full" />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {block.type === 'button' && (
        <div style={{ textAlign: (block.align as any) || 'left', padding: padding(block), width: '100%' }}>
          <div 
            className="relative"
            style={{ 
              maxWidth: '100%',
              display: (!block.width || block.width === '100%') ? 'inline-block' : 'block',
              width: (!block.width || block.width === '100%') ? 'auto' : '100%'
            }}
          >
            <button
              className={`text-xs font-bold py-2.5 px-6 pointer-events-none ${(!block.width || block.width === '100%') ? 'w-auto' : 'w-full'}`}
              style={{
                backgroundColor: block.style?.btnVariant === 'outline' ? 'transparent' : (block.style?.btnBgColor ?? globalStyle.buttonBgColor),
                border: block.style?.btnVariant === 'outline' ? `2px solid ${block.style?.btnBgColor ?? globalStyle.buttonBgColor}` : undefined,
                color: block.style?.btnVariant === 'outline' ? (block.style?.btnTextColor ?? block.style?.btnBgColor ?? globalStyle.buttonBgColor) : (block.style?.btnTextColor ?? globalStyle.buttonTextColor),
                borderRadius: `${block.style?.btnRadius ?? globalStyle.buttonRadius}px`,
                fontFamily: block.style?.fontFamily ?? globalStyle.fontFamily,
                height: block.style?.height ? `${block.style.height}px` : undefined,
                padding: block.style?.height ? '0 24px' : undefined,
                display: (!block.width || block.width === '100%') ? 'inline-block' : 'block'
              }}
            >
              {block.content || 'Action Button'}
            </button>
            
            {/* Visual selection outline and resize handle */}
            {selectedBlockId === block.id && (
              <>
                <div className="absolute inset-0 border-2 border-accent/80 rounded pointer-events-none z-10" />
                <div 
                  onPointerDown={(e) => handleImageResizeStart(e, block.id, block.style?.height)}
                  className="absolute -right-1.5 -bottom-1.5 w-3.5 h-3.5 bg-accent hover:bg-accent/90 rounded-full border-2 border-white shadow-lg cursor-se-resize z-20 pointer-events-auto flex items-center justify-center transition-transform hover:scale-125 touch-none before:absolute before:-inset-3 before:content-['']"
                  title="Drag to resize"
                >
                  <span className="block w-1 h-1 bg-white rounded-full" />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {block.type === 'divider' && (
        <hr
          className="pointer-events-none select-none border-0 border-t"
          style={{ borderTopColor: block.style?.dividerColor ?? '#e5e7eb', marginTop: '20px', marginBottom: '20px' }}
        />
      )}

      {block.type === 'spacer' && (
        <div className="relative">
          <div 
            className="border border-dashed rounded flex items-center justify-center text-[9px] select-none pointer-events-none bg-slate-50 border-slate-200 text-slate-400"
            style={{ height: `${block.content || '30'}px` }}
          >
            Spacer ({block.content || '30'}px)
          </div>
          {selectedBlockId === block.id && (
            <div 
              onPointerDown={(e) => handleSpacerResizeStart(e, block.id, parseInt(block.content || '30'))}
              className="absolute left-1/2 -bottom-1.5 -translate-x-1/2 w-8 h-3 bg-accent hover:bg-accent/90 rounded-full border-2 border-white shadow-lg cursor-ns-resize z-20 pointer-events-auto flex items-center justify-center transition-transform hover:scale-110 touch-none before:absolute before:-inset-3 before:content-['']"
              title="Drag to resize height"
            >
              <span className="block w-3 h-0.5 bg-white rounded-full" />
            </div>
          )}
        </div>
      )}

      {block.type === 'social' && (
        <div 
          className="flex justify-center gap-4 text-xs font-semibold pointer-events-none select-none text-[#4b5563]"
          style={{
            padding: padding(block),
            borderTop: '1px solid #f3f4f6',
            fontFamily: globalStyle.fontFamily
          }}
        >
          <span>Twitter</span>
          <span>LinkedIn</span>
        </div>
      )}

      {block.type === 'html' && (
        <div className="my-2 w-full bg-white rounded border overflow-hidden">
          <iframe
            sandbox="allow-same-origin"
            srcDoc={block.content}
            className="w-full border-0 pointer-events-none select-none"
            style={{ minHeight: '600px', height: 'auto' }}
            title="HTML Block Preview"

            onLoad={(e) => {
              const iframe = e.currentTarget;
              if (iframe.contentWindow) {
                try {
                  iframe.style.height = iframe.contentWindow.document.documentElement.scrollHeight + 'px';
                } catch (err) {
                  iframe.style.height = '600px';
                }
              }
            }}
          />
        </div>
      )}

      {block.type === 'dynamic' && (
        <div 
          className="p-2.5 border border-dashed rounded font-mono text-xs pointer-events-none select-none bg-slate-50 border-slate-200 text-slate-700"
          style={{ marginBottom: '16px' }}
        >
          &#123;&#123; {block.content || 'dynamic_var'} &#125;&#125;
        </div>
      )}

      {block.type === 'split' && (
        <div 
          className="flex gap-4 items-start pointer-events-none select-none"
          style={{ padding: padding(block) }}
        >
          <img src={block.subImage} className="w-1/3 rounded object-cover aspect-video" alt="split row element" />
          <div className="flex-1 min-w-0" style={{ fontFamily: globalStyle.fontFamily }}>
            <h4 className="font-bold text-base leading-tight truncate text-[#111827]">{block.content}</h4>
            <p className="text-xs mt-1 leading-snug line-clamp-3 text-[#4b5563]">{block.subContent}</p>
            <button 
              className="text-[10px] font-bold py-1.5 px-3 mt-2 pointer-events-none"
              style={{ 
                backgroundColor: globalStyle.buttonBgColor, 
                color: globalStyle.buttonTextColor,
                borderRadius: `${globalStyle.buttonRadius}px`
              }}
            >
              Read More
            </button>
          </div>
        </div>
      )}

      {block.type === 'survey' && (
        <div style={{ padding: padding(block), textAlign: block.align || 'center', fontFamily: block.style?.fontFamily ?? globalStyle.fontFamily }}>
          {!block.surveyId ? (
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center text-xs text-slate-500">
              Pick a survey for this block in the editor panel
            </div>
          ) : (
            <div className="pointer-events-none">
              {block.subContent && <div style={{ fontSize: 15, paddingBottom: 12, color: block.style?.color ?? '#18181b' }}>{block.subContent}</div>}
              {block.surveyMode === 'inline' && block.surveySnapshot ? (
                // Same markup the compiler emits, so the canvas matches the sent email.
                <div
                  dangerouslySetInnerHTML={{
                    __html: renderSurveyInlineHtml(block.surveyId, block.surveySnapshot, {
                      accent: block.style?.btnBgColor ?? globalStyle.buttonBgColor,
                      accentText: block.style?.btnTextColor ?? globalStyle.buttonTextColor,
                      textColor: block.style?.color ?? '#18181b',
                      font: block.style?.fontFamily ?? globalStyle.fontFamily,
                      radius: Math.min(block.style?.btnRadius ?? globalStyle.buttonRadius, 8),
                    }),
                  }}
                />
              ) : (
                <span
                  style={{
                    display: 'inline-block',
                    padding: '12px 28px',
                    fontSize: 15,
                    fontWeight: 700,
                    background: block.style?.btnBgColor ?? globalStyle.buttonBgColor,
                    color: block.style?.btnTextColor ?? globalStyle.buttonTextColor,
                    borderRadius: block.style?.btnRadius ?? globalStyle.buttonRadius,
                  }}
                >
                  {block.content || 'Take the survey'}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {block.type === 'section' && (
        <div
          className="pointer-events-none select-none rounded"
          style={{
            backgroundColor: block.style?.bgColor ?? 'transparent',
            padding: padding(block),
            borderRadius: `${block.style?.borderRadius ?? 0}px`,
          }}
        >
          {(block.children || []).map(child => (
            <SectionChildPreview key={child.id} child={child} globalStyle={globalStyle} />
          ))}
          {(block.children || []).length === 0 && (
            <p className="text-xs text-slate-400 italic">Empty section — edit in the sidebar to add content.</p>
          )}
        </div>
      )}

      {block.type === 'navigation' && (
        <div
          className="pointer-events-none select-none flex items-center justify-between gap-4 flex-wrap"
          style={{ padding: padding(block), backgroundColor: block.style?.bgColor, fontFamily: block.style?.fontFamily ?? globalStyle.fontFamily }}
        >
          {/^(https?:)?\/\//.test(block.content || '') ? (
            <img src={block.content} alt={block.alt || 'Logo'} className="h-6 object-contain" />
          ) : (
            <span className="font-bold tracking-tight" style={{ fontSize: `${block.style?.fontSize ?? 18}px`, color: block.style?.color ?? '#111827' }}>
              {block.content || 'MY BRAND'}
            </span>
          )}
          <div className="flex gap-4 text-sm" style={{ color: block.style?.linkColor ?? block.style?.color ?? '#111827' }}>
            {(block.links?.length ? block.links : [{ id: 'n1', label: 'Shop', url: '#' }, { id: 'n2', label: 'About', url: '#' }, { id: 'n3', label: 'Contact', url: '#' }]).map(l => (
              <span key={l.id}>{l.label}</span>
            ))}
          </div>
        </div>
      )}

      {block.type === 'footer' && (
        <div
          className="pointer-events-none select-none text-center"
          style={{
            padding: padding(block),
            backgroundColor: block.style?.bgColor,
            borderTop: block.style?.borderColor ? `1px solid ${block.style.borderColor}` : undefined,
            fontFamily: block.style?.fontFamily ?? globalStyle.fontFamily,
            color: block.style?.color ?? '#6b7280',
          }}
        >
          {(block.socials || []).length > 0 && (
            <div className="flex justify-center gap-3 text-[13px] mb-3">
              {block.socials!.map(sl => (
                sl.icon ? <img key={sl.id} src={sl.icon} alt={sl.label} className="w-5 h-5 object-contain" /> : <span key={sl.id}>{sl.label}</span>
              ))}
            </div>
          )}
          <div className="flex justify-center gap-4 text-[13px] underline mb-3" style={{ color: block.style?.linkColor ?? block.style?.color ?? '#6b7280' }}>
            {(block.links?.length ? block.links : [{ id: 'f1', label: 'Unsubscribe', url: '#' }, { id: 'f2', label: 'Privacy', url: '#' }, { id: 'f3', label: 'Contact', url: '#' }]).map(l => (
              <span key={l.id}>{l.label}</span>
            ))}
          </div>
          <p className="text-xs leading-relaxed whitespace-pre-wrap">{block.content || 'Your address goes here.'}</p>
        </div>
      )}

      {block.type === 'articles' && (
        <div
          className="grid grid-cols-2 gap-5 pointer-events-none select-none"
          style={{ padding: padding(block), fontFamily: block.style?.fontFamily ?? globalStyle.fontFamily }}
        >
          {(block.items || []).map(item => (
            <div key={item.id}>
              <img src={item.image} alt={item.alt || ''} className="w-full rounded aspect-video object-cover" />
              <h4 className="font-bold text-sm leading-snug mt-3" style={{ color: block.style?.color ?? '#111827' }}>{item.title}</h4>
              <p className="text-xs text-slate-500 mt-1 leading-snug">{item.text}</p>
              <span className="text-[11px] font-bold mt-2 inline-block" style={{ color: block.style?.linkColor ?? globalStyle.linkColor ?? '#2563eb' }}>Read more &rarr;</span>
            </div>
          ))}
          {(block.items || []).length === 0 && <p className="text-xs text-slate-400 italic col-span-2">No articles yet — add some in the sidebar.</p>}
        </div>
      )}

      {block.type === 'product' && (
        <div
          className="grid grid-cols-2 gap-5 pointer-events-none select-none"
          style={{ padding: padding(block), fontFamily: block.style?.fontFamily ?? globalStyle.fontFamily }}
        >
          {(block.items || []).map(item => (
            <div key={item.id} className="text-center">
              <img src={item.image} alt={item.alt || item.title} className="w-full rounded aspect-square object-cover" />
              <h4 className="font-bold text-sm mt-3" style={{ color: '#111827' }}>{item.title}</h4>
              {item.text && <p className="text-[11px] text-slate-500 mt-0.5">{item.text}</p>}
              <p className="text-sm font-bold mt-1" style={{ color: block.style?.color ?? '#111827' }}>
                {item.price}
                {item.comparePrice && <span className="ml-1.5 text-slate-400 font-normal line-through">{item.comparePrice}</span>}
              </p>
              <span
                className="inline-block text-[11px] font-bold py-1.5 px-4 mt-2.5"
                style={{
                  backgroundColor: block.style?.btnBgColor ?? globalStyle.buttonBgColor,
                  color: block.style?.btnTextColor ?? globalStyle.buttonTextColor,
                  borderRadius: `${block.style?.btnRadius ?? globalStyle.buttonRadius}px`,
                }}
              >
                {block.content || 'Buy now'}
              </span>
            </div>
          ))}
          {(block.items || []).length === 0 && <p className="text-xs text-slate-400 italic col-span-2">No products yet — add some in the sidebar.</p>}
        </div>
      )}

      {block.type === 'receipt' && (
        <div
          className="pointer-events-none select-none"
          style={{ padding: padding(block), fontFamily: block.style?.fontFamily ?? globalStyle.fontFamily, color: block.style?.color ?? '#111827' }}
        >
          <table className="w-full border-collapse">
            <tbody>
              {block.content && (
                <tr>
                  <th colSpan={3} className="text-center font-bold text-lg py-2.5" style={{ borderBottom: `2px solid ${block.style?.borderColor ?? '#d5d5d5'}` }}>
                    {block.content}
                  </th>
                </tr>
              )}
              {(block.items || []).map(item => (
                <tr key={item.id}>
                  <td className="w-3/5 pt-2.5 text-sm">
                    {item.title}
                    {item.text && <span className="block text-xs text-slate-500">{item.text}</span>}
                  </td>
                  <td className="w-1/5 pt-2.5 text-sm text-right">{item.qty}</td>
                  <td className="w-1/5 pt-2.5 text-sm text-right">{item.price}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="pt-2.5" style={{ borderBottom: `1px solid ${block.style?.borderColor ?? '#d5d5d5'}` }} />
              </tr>
              {(block.summaryRows?.length ? block.summaryRows : [{ id: 'sr1', label: 'Total', value: '', emphasis: true }]).map(row => (
                <tr key={row.id}>
                  <td colSpan={2} className={`pt-2.5 text-sm ${row.emphasis ? 'font-bold text-base' : ''}`}>{row.label}</td>
                  <td className={`pt-2.5 text-sm text-right ${row.emphasis ? 'font-bold text-base' : ''}`}>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(block.items || []).length === 0 && <p className="text-xs text-slate-400 italic mt-2">No line items yet — add some in the sidebar.</p>}
        </div>
      )}

      {block.type === 'notice' && (
        <div
          className="pointer-events-none select-none"
          style={{ padding: padding(block), fontFamily: block.style?.fontFamily ?? globalStyle.fontFamily }}
        >
          {(block.items || []).map((item, i, arr) => (
            <div
              key={item.id}
              className="py-4 first:pt-0"
              style={{ borderBottom: i < arr.length - 1 ? `1px solid ${block.style?.borderColor ?? '#e5e7eb'}` : undefined }}
            >
              {item.badge && (
                <span
                  className="inline-block text-[11px] font-bold tracking-wide text-white px-2 py-0.5 rounded"
                  style={{ backgroundColor: item.badgeColor || '#6b7280' }}
                >
                  {item.badge.toUpperCase()}
                </span>
              )}
              <h4 className="font-bold text-base mt-2.5 mb-1.5" style={{ color: block.style?.color ?? '#111827' }}>{item.title}</h4>
              <p className="text-sm text-slate-500 leading-snug">{item.text}</p>
              {item.url && (
                <span className="text-xs font-bold mt-2.5 inline-block" style={{ color: block.style?.linkColor ?? globalStyle.linkColor ?? '#2563eb' }}>
                  {block.content || 'Details'} &rarr;
                </span>
              )}
            </div>
          ))}
          {(block.items || []).length === 0 && <p className="text-xs text-slate-400 italic">No notices yet — add some in the sidebar.</p>}
        </div>
      )}

      {block.type === 'columns' && (
        <div 
          className="grid grid-cols-3 gap-3 pointer-events-none select-none"
          style={{ padding: padding(block) }}
        >
          {(block.items || []).map(item => (
            <div key={item.id} className="text-center" style={{ fontFamily: globalStyle.fontFamily }}>
              <img src={item.image} className="w-full rounded aspect-video object-cover mb-1" alt="column item" />
              <h5 className="font-bold text-[11px] leading-tight truncate text-[#111827]">{item.title}</h5>
              <p className="text-[10px] text-slate-400 mt-0.5 truncate">{item.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Static, non-interactive preview of a block nested inside a 'section' — no drag/resize handles. */
function SectionChildPreview({ child, globalStyle }: { child: EmailBlock; globalStyle: GlobalStyle }) {
  const font = child.style?.fontFamily ?? globalStyle.fontFamily

  switch (child.type) {
    case 'title':
      return (
        <h1 style={{ fontFamily: font, color: child.style?.color ?? '#111827', fontSize: `${child.style?.fontSize ?? 24}px`, fontWeight: child.style?.fontWeight ?? 'bold', textAlign: child.style?.textAlign ?? child.align ?? 'left', margin: '0 0 8px 0' }}>
          {child.content}
        </h1>
      )
    case 'text':
      return (
        <p style={{ fontFamily: font, color: child.style?.color ?? '#4b5563', fontSize: `${child.style?.fontSize ?? 15}px`, textAlign: child.style?.textAlign ?? child.align ?? 'left', margin: '0 0 8px 0' }}>
          {child.content}
        </p>
      )
    case 'button':
      return (
        <div style={{ textAlign: child.align ?? 'left', margin: '8px 0' }}>
          <span
            className="inline-block text-xs font-bold py-2 px-5"
            style={{
              backgroundColor: child.style?.btnBgColor ?? globalStyle.buttonBgColor,
              color: child.style?.btnTextColor ?? globalStyle.buttonTextColor,
              borderRadius: `${child.style?.btnRadius ?? globalStyle.buttonRadius}px`,
              fontFamily: font,
            }}
          >
            {child.content}
          </span>
        </div>
      )
    case 'image':
      return <img src={child.content} alt="" className="w-full rounded object-cover mb-2" />
    case 'logo':
      return (
        <div style={{ fontFamily: font, color: child.style?.color ?? '#111827', fontSize: `${child.style?.fontSize ?? 20}px`, fontWeight: 800, textAlign: child.align ?? 'center', margin: '0 0 8px 0' }}>
          {isImageUrl(child.content) ? <LogoImage block={child} /> : child.content}
        </div>
      )
    case 'divider':
      return <hr style={{ borderTopColor: child.style?.dividerColor ?? '#e5e7eb', margin: '12px 0' }} className="border-0 border-t" />
    case 'spacer':
      return <div style={{ height: `${child.content || '20'}px` }} />
    default:
      return <p className="text-xs text-slate-400">{child.content}</p>
  }
}

/** Same sniff as `renderLogo` in compiler.ts: a URL means an image logo, anything else is text. */
const isImageUrl = (value?: string) => /^(https?:)?\/\//.test(value || '')

/** Canvas twin of the compiled image logo: 140px wide unless a height is set. */
function LogoImage({ block }: { block: EmailBlock }) {
  const height = block.style?.height
  return (
    <img
      src={block.content}
      alt={block.alt || 'Logo'}
      className="inline-block align-middle"
      style={height ? { height: `${height}px`, width: 'auto' } : { width: '140px', height: 'auto' }}
    />
  )
}
