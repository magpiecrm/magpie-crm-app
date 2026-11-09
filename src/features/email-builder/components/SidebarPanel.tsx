import type React from 'react'
import type { DragPayload } from '../hooks/useBlockDrag'
import type { EmailBlock, GlobalStyle } from '../types'
import { STARTER_CATEGORIES, type StarterTemplate } from '../templates/starters'
import type { EmailTemplate } from '../../templates/types'
import { useState } from 'react'
import { Search } from 'lucide-react'
import { TemplateTile } from '../../templates/components/TemplateTile'
import { starterHtml } from '../../templates/preview'
import { INPUT_CLASS } from '../../../components/ui/Field'
import { BlockEditor } from './BlockEditor'

/**
 * The content tabs, in order, with the names they show. Starters
 * ('templates') and your own ('saved') share one Templates tab, one list.
 */
const CONTENT_TABS = [
  { id: 'blocks', label: 'Blocks' },
  { id: 'sections', label: 'Sections' },
  { id: 'templates', label: 'Templates' },
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
            {CONTENT_TABS.map(tab => {
              const current = contentTab === tab.id || (tab.id === 'templates' && contentTab === 'saved')
              return (
                <button
                  key={tab.id}
                  onClick={() => setContentTab(tab.id === 'templates' && current ? contentTab : tab.id)}
                  className={`flex-1 py-2.5 text-[13px] font-semibold border-b-2 transition-colors ${
                    current ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
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

                {(contentTab === 'templates' || contentTab === 'saved') && (
                  <TemplatesTab
                    starters={templates}
                    applyStarter={applyTemplate}
                    saved={savedTemplates}
                    applySaved={applySavedTemplate}
                    onSaveAsTemplate={onSaveAsTemplate}
                  />
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

/** One template in the panel: a wide picture of its opening, its name under it. Clicking uses it. */
function PanelTemplate({ html, name, onUse }: { html: string; name: string; onUse: () => void }) {
  return <TemplateTile html={html} name={name} shape="aspect-[16/10]" fromTop onSelect={onUse} />
}

/**
 * The team's own templates, then the starters by kind, in one list with one
 * search. Using one replaces the canvas (after asking, if it has blocks).
 */
function TemplatesTab({
  starters,
  applyStarter,
  saved,
  applySaved,
  onSaveAsTemplate,
}: {
  starters: StarterTemplate[]
  applyStarter: (template: StarterTemplate) => void
  saved: EmailTemplate[] | undefined
  applySaved: (template: EmailTemplate) => void
  onSaveAsTemplate: () => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const matches = (t: { name: string; description: string }) => !q || `${t.name} ${t.description}`.toLowerCase().includes(q)
  const yours = (saved ?? []).filter(matches)
  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      <div className="space-y-2">
        <label className="relative block">
          <span className="sr-only">Search templates</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search templates" className={`${INPUT_CLASS} pl-9`} />
        </label>
        <p className={PANEL_HINT}>Using one replaces what's on the canvas. You'll be asked first.</p>
      </div>

      <section className="space-y-3">
        <h3 className="flex items-baseline justify-between text-[13px] font-semibold text-foreground">
          Your templates {saved && <span className="font-normal tabular-nums text-muted-foreground">{saved.length}</span>}
        </h3>
        {saved === undefined ? (
          <div className="aspect-[16/10] animate-pulse rounded-md-m bg-muted" />
        ) : saved.length === 0 ? (
          <div className="rounded-md-m border border-dashed border-border px-4 py-5 text-center">
            <p className="text-xs leading-relaxed text-muted-foreground">None yet. Keep this design to start other emails from.</p>
            <button onClick={onSaveAsTemplate} className="mt-2 cursor-pointer text-xs font-semibold text-accent underline-offset-2 hover:underline">
              Save as template
            </button>
          </div>
        ) : yours.length === 0 ? (
          <p className="text-xs text-muted-foreground">None match.</p>
        ) : (
          yours.map(template => <PanelTemplate key={template.id} html={template.html} name={template.name} onUse={() => applySaved(template)} />)
        )}
      </section>

      {STARTER_CATEGORIES.map(category => {
        const inCategory = starters.filter(t => t.category === category && matches(t))
        if (inCategory.length === 0) return null
        return (
          <section key={category} className="space-y-3">
            <h3 className="text-[13px] font-semibold text-foreground">
              Starters <span className="font-normal text-muted-foreground">· {category}</span>
            </h3>
            {inCategory.map(template => (
              <PanelTemplate key={template.id} html={starterHtml(template)} name={template.name} onUse={() => applyStarter(template)} />
            ))}
          </section>
        )
      })}
    </div>
  )
}
