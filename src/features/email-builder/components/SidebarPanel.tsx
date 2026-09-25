import type React from 'react'
import type { DragPayload } from '../hooks/useBlockDrag'
import type { EmailBlock, GlobalStyle } from '../types'
import type { StarterTemplate } from '../templates/starters'
import type { EmailTemplate } from '../../templates/types'
import { BlockEditor } from './BlockEditor'
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
            {(['blocks', 'templates', 'sections', 'saved'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setContentTab(tab)}
                className={`flex-1 py-2.5 text-[11px] font-semibold border-b-2 capitalize transition-colors ${
                  contentTab === tab ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab}
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
                    <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Element blocks</span>
                    <p className="text-[10px] text-muted-foreground/80 mt-0.5 leading-snug">Drag elements to the template canvas or click to insert at the bottom.</p>
                    
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
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div>
                      <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Starter templates</span>
                      <p className="text-[10px] text-muted-foreground/80 mt-0.5 leading-snug">
                        Complete, responsive designs. Applying one replaces the canvas — swap the placeholder images for your own before sending.
                      </p>
                    </div>

                    {['Newsletter', 'E-commerce', 'Transactional'].map(category => {
                      const inCategory = templates.filter(t => t.category === category)
                      if (inCategory.length === 0) return null
                      return (
                        <div key={category} className="space-y-2">
                          <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider">{category}</span>
                          {inCategory.map(template => (
                            <button
                              key={template.id}
                              onClick={() => applyTemplate(template)}
                              className="w-full p-3.5 bg-muted/20 border border-border/60 hover:border-accent/30 rounded-xl text-left hover:bg-accent/5 transition-all group"
                            >
                              <p className="font-bold text-xs text-foreground group-hover:text-accent transition-colors">{template.name}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{template.description}</p>
                            </button>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )}

                {contentTab === 'sections' && (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div>
                      <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Predefined layouts</span>
                      <p className="text-[10px] text-muted-foreground/80 mt-0.5 leading-snug">Quickly add structured sections with placeholder text and graphics.</p>
                    </div>

                    <div className="space-y-3">
                      <button 
                        onClick={() => addSection('hero')}
                        className="w-full p-4 bg-muted/20 border border-border/60 hover:border-accent/30 rounded-xl text-left hover:bg-accent/5 transition-all group"
                      >
                        <p className="font-bold text-xs text-foreground group-hover:text-accent transition-colors">Featured Hero Section</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Hero image, title, paragraph and primary button.</p>
                      </button>
                      
                      <button 
                        onClick={() => addSection('split')}
                        className="w-full p-4 bg-muted/20 border border-border/60 hover:border-accent/30 rounded-xl text-left hover:bg-accent/5 transition-all group"
                      >
                        <p className="font-bold text-xs text-foreground group-hover:text-accent transition-colors">Split Article Row</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Side-by-side split image and content layout.</p>
                      </button>

                      <button 
                        onClick={() => addSection('features')}
                        className="w-full p-4 bg-muted/20 border border-border/60 hover:border-accent/30 rounded-xl text-left hover:bg-accent/5 transition-all group"
                      >
                        <p className="font-bold text-xs text-foreground group-hover:text-accent transition-colors">3-Column Feature Cards</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Triple columns grid highlighting features/services.</p>
                      </button>
                    </div>
                  </div>
                )}

                {contentTab === 'saved' && (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div>
                      <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Your templates</span>
                      <p className="text-[10px] text-muted-foreground/80 mt-0.5 leading-snug">
                        Designs you've saved. Applying one replaces the canvas.
                      </p>
                    </div>

                    <button
                      onClick={onSaveAsTemplate}
                      className="w-full p-3 border border-dashed border-border hover:border-accent/40 rounded-xl text-xs font-semibold text-muted-foreground hover:text-accent hover:bg-accent/5 transition-all"
                    >
                      Save current design as template
                    </button>

                    {savedTemplates === undefined ? (
                      <p className="text-[10px] text-muted-foreground text-center py-4">Loading…</p>
                    ) : savedTemplates.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground text-center py-4">No saved templates yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {savedTemplates.map(template => (
                          <button
                            key={template.id}
                            onClick={() => applySavedTemplate(template)}
                            className="w-full p-3.5 bg-muted/20 border border-border/60 hover:border-accent/30 rounded-xl text-left hover:bg-accent/5 transition-all group"
                          >
                            <p className="font-bold text-xs text-foreground group-hover:text-accent transition-colors">{template.name}</p>
                            {template.description && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{template.description}</p>
                            )}
                          </button>
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
        // STYLE TAB matching Brevo's structure
        <GlobalStyleEditor 
          globalStyle={globalStyle}
          setGlobalStyle={setGlobalStyle}
        />
      )}
    </div>
  )
}
