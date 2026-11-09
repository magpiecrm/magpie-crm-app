import type React from 'react'
import type { DragPayload } from '../hooks/useBlockDrag'
import type { EmailBlock, GlobalStyle } from '../types'
import { STARTER_CATEGORIES, type StarterTemplate } from '../templates/starters'
import type { EmailTemplate } from '../../templates/types'
import { TemplateTile } from '../../templates/components/TemplateTile'
import { starterHtml } from '../../templates/preview'
import { BlockEditor } from './BlockEditor'

/** The content tabs, in order, with the names they show. */
const CONTENT_TABS = [
  { id: 'blocks', label: 'Blocks' },
  { id: 'sections', label: 'Sections' },
  { id: 'templates', label: 'Starters' },
  { id: 'saved', label: 'Saved' },
] as const

/** A group's label in the side panel. */
const PANEL_LABEL = 'text-xs font-semibold text-muted-foreground'
const PANEL_HINT = 'text-xs leading-snug text-muted-foreground mt-1'
import { GlobalStyleEditor } from './GlobalStyleEditor'

interface SidebarPanelProps {
  activeMenu: 'content' | 'style'
  contentTab: 'blocks' | 'templates' | 'sections' | 'saved'
  setContentTab: (tab: 'blocks' | 'templates' | 'sections' | 'saved') => void
  selectedBlock: EmailBlock | undefined
  setSelectedBlockId: (id: string | null) => void
  globalStyle: GlobalStyle
  setGlobalStyle: (style: GlobalStyle) => void
  updateBlockContent: (id: string, updates: Partial<EmailBlock>) => void
  addBlock: (type: EmailBlock['type']) => void
  addSection: (sectionType: 'hero' | 'split' | 'features') => void
  templates: StarterTemplate[]
  applyTemplate: (template: StarterTemplate) => void
  savedTemplates: EmailTemplate[] | undefined
  applySavedTemplate: (template: EmailTemplate) => void
  onSaveAsTemplate: () => void
  emailBlocksList: Array<{ type: string; label: string; icon: React.ReactNode }>
  startDrag: (e: React.PointerEvent, payload: DragPayload) => void
  didDrag: React.RefObject<boolean>
}

export function SidebarPanel({
  activeMenu,
  contentTab,
  setContentTab,
  selectedBlock,
  setSelectedBlockId,
  globalStyle,
  setGlobalStyle,
  updateBlockContent,
  addBlock,
  addSection,
  templates,
  applyTemplate,
  savedTemplates,
  applySavedTemplate,
  onSaveAsTemplate,
  emailBlocksList,
  startDrag,
  didDrag,
}: SidebarPanelProps) {
  return (
    <div className="w-full lg:w-80 lg:border-r border-border bg-card flex flex-col shrink-0 overflow-hidden lg:sticky lg:top-0 h-full lg:h-[calc(100dvh-64px)]">
      {activeMenu === 'content' ? (
        // CONTENT TAB
        <div className="flex flex-col h-full overflow-hidden">
          <div className="flex border-b border-border select-none bg-muted/15 shrink-0">
            {CONTENT_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setContentTab(tab.id)}
                className={`flex-1 py-2.5 text-[13px] font-semibold border-b-2 transition-colors ${
                  contentTab === tab.id ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {selectedBlock ? (
              // Inline properties panel when selecting a block
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex justify-between items-center pb-2 border-b border-border/60">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Edit Block</h3>
                  <button onClick={() => setSelectedBlockId(null)} className="text-[10px] text-accent hover:underline font-semibold">
                    Back to blocks
                  </button>
                </div>
                <BlockEditor 
                  selectedBlock={selectedBlock}
                  globalStyle={globalStyle}
                  updateBlockContent={updateBlockContent}
                />
              </div>
            ) : (
              // Navigation content options
              <div>
                {contentTab === 'blocks' && (
                  <div className="animate-in fade-in duration-200">
                    <h3 className={PANEL_LABEL}>Blocks</h3>
                    <p className={PANEL_HINT}>Drag one onto the canvas, or click to add it at the bottom.</p>
                    
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-2 gap-2 mt-4 select-none">
                      {emailBlocksList.map(item => (
                        <button
                          key={item.type}
                          onClick={() => {
                            // A completed drag already inserted the block.
                            if (didDrag.current) return
                            addBlock(item.type as any)
                          }}
                          onPointerDown={(e) => startDrag(e, { kind: 'new', blockType: item.type as any })}
                          className="p-3 bg-muted/30 border border-border/80 hover:border-accent/40 rounded-xl flex flex-col items-center justify-center gap-1.5 text-center transition-all hover:bg-accent/5 hover:text-accent group text-xs font-semibold cursor-grab active:cursor-grabbing touch-none"
                        >
                          <div className="text-muted-foreground group-hover:text-accent transition-colors">
                            {item.icon}
                          </div>
                          <span className="text-[10px] leading-tight truncate w-full">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {contentTab === 'templates' && (
                  <div className="space-y-5 animate-in fade-in duration-200">
                    <div>
                      <h3 className={PANEL_LABEL}>Starter layouts</h3>
                      <p className={PANEL_HINT}>Complete designs to build on. Using one replaces the canvas.</p>
                    </div>

                    {STARTER_CATEGORIES.map(category => {
                      const inCategory = templates.filter(t => t.category === category)
                      if (inCategory.length === 0) return null
                      return (
                        <section key={category} className="space-y-2.5">
                          <h4 className={PANEL_LABEL}>{category}</h4>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                            {inCategory.map(template => (
                              <TemplateTile
                                key={template.id}
                                size="sm"
                                html={starterHtml(template)}
                                name={template.name}
                                onSelect={() => applyTemplate(template)}
                              />
                            ))}
                          </div>
                        </section>
                      )
                    })}
                  </div>
                )}

                {contentTab === 'sections' && (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div>
                      <h3 className={PANEL_LABEL}>Sections</h3>
                      <p className={PANEL_HINT}>Groups of blocks with placeholder text and images, added at the bottom.</p>
                    </div>

                    <div className="space-y-3">
                      <button 
                        onClick={() => addSection('hero')}
                        className="w-full p-4 bg-muted/20 border border-border/60 hover:border-accent/30 rounded-xl text-left hover:bg-accent/5 transition-all group"
                      >
                        <p className="font-semibold text-[13px] text-foreground group-hover:text-accent transition-colors">Hero</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">An image, a heading, a paragraph and a button.</p>
                      </button>
                      
                      <button 
                        onClick={() => addSection('split')}
                        className="w-full p-4 bg-muted/20 border border-border/60 hover:border-accent/30 rounded-xl text-left hover:bg-accent/5 transition-all group"
                      >
                        <p className="font-semibold text-[13px] text-foreground group-hover:text-accent transition-colors">Image beside text</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">An image with a heading and text next to it.</p>
                      </button>

                      <button 
                        onClick={() => addSection('features')}
                        className="w-full p-4 bg-muted/20 border border-border/60 hover:border-accent/30 rounded-xl text-left hover:bg-accent/5 transition-all group"
                      >
                        <p className="font-semibold text-[13px] text-foreground group-hover:text-accent transition-colors">Three features</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">Three columns, each with an image, a heading and a line.</p>
                      </button>
                    </div>
                  </div>
                )}

                {contentTab === 'saved' && (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div>
                      <h3 className={PANEL_LABEL}>Your templates</h3>
                      <p className={PANEL_HINT}>Designs your team has saved. Using one replaces the canvas.</p>
                    </div>

                    {savedTemplates === undefined ? (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-md-m bg-muted" />)}
                      </div>
                    ) : savedTemplates.length === 0 ? (
                      <div className="rounded-md-m border border-dashed border-border px-4 py-6 text-center">
                        <p className="text-sm font-medium text-foreground">No saved templates yet</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Keep this design to start other emails from.</p>
                        <button
                          onClick={onSaveAsTemplate}
                          className="mt-3 cursor-pointer text-xs font-semibold text-accent underline-offset-2 hover:underline"
                        >
                          Save as template
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                        {savedTemplates.map(template => (
                          <TemplateTile
                            key={template.id}
                            size="sm"
                            html={template.html}
                            name={template.name}
                            onSelect={() => applySavedTemplate(template)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        // Style tab
        <GlobalStyleEditor 
          globalStyle={globalStyle}
          setGlobalStyle={setGlobalStyle}
        />
      )}
    </div>
  )
}
