import type React from 'react'
import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Search, Trash2 } from 'lucide-react'
import type { DragPayload } from '../../email-builder/hooks/useBlockDrag'
import type { ContactFieldDef } from '../../contacts/contactFields'
import type { SurveyBlock, SurveyBlockType, SurveyDesign, SurveySettings, SurveyTheme } from '../types'
import { SURVEY_BLOCK_TYPES } from '../types'
import type { SurveyStarterTemplate } from '../templates/starters'
import type { LintIssue } from '../logic/lint'
import type { SurveyMenu } from './SurveySidebarMenu'
import type { Dispatch } from './SurveyBlockEditor'
import { SurveyBlockEditor, hintClass, inputClass, sectionLabelClass } from './SurveyBlockEditor'
import { BLOCK_GROUPS, BLOCK_LOOK, BlockChip } from '../blockIcons'
import { SurveyThemeEditor } from './SurveyThemeEditor'
import { LogicEditor } from './LogicEditor'
import { SurveySettingsPanel } from './SurveySettingsPanel'
import { confirmDialog } from '../../../components/ui/confirm'

export type SurveyContentTab = 'blocks' | 'templates' | 'pages'

interface SurveySidebarPanelProps {
  activeMenu: SurveyMenu
  contentTab: SurveyContentTab
  setContentTab: (tab: SurveyContentTab) => void
  design: SurveyDesign
  settings: SurveySettings
  setSettings: (updates: Partial<SurveySettings>) => void
  dispatch: Dispatch
  selectedBlock: SurveyBlock | undefined
  setSelectedBlockId: (id: string | null) => void
  selectedPageId: string | null
  setSelectedPageId: (id: string) => void
  addBlock: (type: SurveyBlockType) => void
  templates: SurveyStarterTemplate[]
  applyTemplate: (template: SurveyStarterTemplate) => void
  startDrag: (e: React.PointerEvent, payload: DragPayload<SurveyBlockType>) => void
  didDrag: React.RefObject<boolean>
  lockedBlockIds: Set<string>
  lockedOptionIds: Set<string>
  contactFields: ContactFieldDef[]
  issues: LintIssue[]
}

export function SurveySidebarPanel(props: SurveySidebarPanelProps) {
  const { activeMenu, design, dispatch, settings, setSettings, issues } = props
  return (
    <div className="w-full lg:w-80 lg:border-r border-border bg-card flex flex-col shrink-0 overflow-hidden lg:sticky lg:top-0 h-full lg:h-[calc(100dvh-64px)]">
      {activeMenu === 'content' && <ContentMenu {...props} />}
      {activeMenu === 'logic' && <LogicEditor design={design} dispatch={dispatch} issues={issues.filter(i => i.area === 'logic' || i.area === 'survey')} />}
      {activeMenu === 'style' && (
        <SurveyThemeEditor theme={design.theme} setTheme={(updates: Partial<SurveyTheme>) => dispatch('survey.setTheme', { updates })} />
      )}
      {activeMenu === 'settings' && <SurveySettingsPanel settings={settings} setSettings={setSettings} issues={issues.filter(i => i.area === 'settings')} />}
    </div>
  )
}

function ContentMenu({
  contentTab,
  setContentTab,
  design,
  dispatch,
  selectedBlock,
  setSelectedBlockId,
  selectedPageId,
  setSelectedPageId,
  addBlock,
  templates,
  applyTemplate,
  startDrag,
  didDrag,
  lockedBlockIds,
  lockedOptionIds,
  contactFields,
  issues,
}: SurveySidebarPanelProps) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()

  if (selectedBlock) {
    const label = SURVEY_BLOCK_TYPES.find(t => t.type === selectedBlock.type)?.label
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {/* On a phone the sheet's own title names the block, and closing it goes back. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5 max-lg:hidden">
          <button
            type="button"
            onClick={() => setSelectedBlockId(null)}
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md-s text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Back to adding questions"
            title="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <BlockChip type={selectedBlock.type} size="sm" />
          <span className="text-sm font-semibold text-foreground">{label}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <SurveyBlockEditor
            block={selectedBlock}
            dispatch={dispatch}
            locked={lockedBlockIds.has(selectedBlock.id)}
            lockedOptionIds={lockedOptionIds}
            contactFields={contactFields}
            issues={issues.filter(i => i.blockId === selectedBlock.id)}
          />
        </div>
      </div>
    )
  }

  const tabs: Array<{ id: SurveyContentTab; label: string }> = [
    { id: 'blocks', label: 'Add' },
    { id: 'templates', label: 'Templates' },
    { id: 'pages', label: `Pages (${design.pages.length})` },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div role="tablist" aria-label="Content" className="flex shrink-0 select-none gap-4 border-b border-border px-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={contentTab === tab.id}
            onClick={() => setContentTab(tab.id)}
            className={`relative min-h-11 cursor-pointer text-[13px] font-medium transition-colors ${
              contentTab === tab.id ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {contentTab === 'blocks' ? (
          <div className="space-y-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a question type" aria-label="Find a question type" className={`${inputClass} pl-8`} />
            </div>
            {BLOCK_GROUPS.map(group => {
              const items = SURVEY_BLOCK_TYPES.filter(t => BLOCK_LOOK[t.type].group === group.id && (!q || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)))
              if (items.length === 0) return null
              return (
                <div key={group.id}>
                  <h3 className={sectionLabelClass}>{group.label}</h3>
                  <div className="mt-2 grid select-none grid-cols-2 gap-1.5 max-sm:grid-cols-2 sm:max-lg:grid-cols-3">
                    {items.map(item => (
                      <button
                        key={item.type}
                        title={item.description}
                        onClick={() => {
                          // A completed drag already inserted the block.
                          if (didDrag.current) return
                          addBlock(item.type)
                        }}
                        onPointerDown={e => startDrag(e, { kind: 'new', blockType: item.type })}
                        className="flex min-h-10 cursor-grab touch-none items-center gap-2 rounded-md-s border border-border bg-card px-2 py-1.5 text-left text-[13px] font-medium text-foreground transition-colors hover:border-foreground/25 hover:bg-muted/60 active:cursor-grabbing"
                      >
                        <BlockChip type={item.type} size="sm" />
                        <span className="min-w-0 truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
            {q && !SURVEY_BLOCK_TYPES.some(t => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)) && <p className={hintClass}>No question type called “{search.trim()}”.</p>}
            <p className={hintClass}>Click one to add it to the page you're on, or drag it to where it should go.</p>
          </div>
        ) : contentTab === 'templates' ? (
          <div className="space-y-5">
            <p className={hintClass}>Starting again from one of these replaces every page.</p>
            {(['Feedback', 'Research', 'Lead gen'] as const).map(category => {
              const inCategory = templates.filter(t => t.category === category)
              if (inCategory.length === 0) return null
              return (
                <div key={category} className="space-y-2">
                  <h3 className={sectionLabelClass}>{category}</h3>
                  {inCategory.map(template => (
                    <button
                      key={template.id}
                      onClick={() => applyTemplate(template)}
                      className="w-full cursor-pointer rounded-md-s border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/60"
                    >
                      <p className="text-[13px] font-semibold text-foreground">{template.name}</p>
                      <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{template.description}</p>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {design.pages.map((page, i) => {
              const hasLocked = page.blocks.some(b => lockedBlockIds.has(b.id))
              return (
                <div
                  key={page.id}
                  onClick={() => setSelectedPageId(page.id)}
                  className={`flex cursor-pointer items-center gap-1 rounded-md-s border p-1.5 pl-2.5 ${selectedPageId === page.id ? 'border-accent bg-accent/5' : 'border-border hover:border-foreground/25'}`}
                >
                  <span className="w-5 shrink-0 text-[13px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                  <input
                    value={page.title ?? ''}
                    placeholder={`Page ${i + 1}`}
                    aria-label={`Name of page ${i + 1}`}
                    onClick={e => e.stopPropagation()}
                    onChange={e => dispatch('survey.updatePage', { id: page.id, updates: { title: e.target.value || undefined } })}
                    className={inputClass}
                  />
                  <button
                    disabled={i === 0}
                    onClick={e => {
                      e.stopPropagation()
                      dispatch('survey.movePage', { id: page.id, direction: 'up' })
                    }}
                    className={pageTool}
                    aria-label="Move page up"
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    disabled={i === design.pages.length - 1}
                    onClick={e => {
                      e.stopPropagation()
                      dispatch('survey.movePage', { id: page.id, direction: 'down' })
                    }}
                    className={pageTool}
                    aria-label="Move page down"
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    disabled={design.pages.length <= 1 || hasLocked}
                    title={hasLocked ? 'It has questions with responses' : 'Delete page'}
                    onClick={async e => {
                      e.stopPropagation()
                      const n = page.blocks.length
                      if (
                        n === 0 ||
                        (await confirmDialog({
                          title: `Delete ${page.title ? `“${page.title}”` : `page ${i + 1}`}?`,
                          message: `Its ${n} ${n === 1 ? 'block goes' : 'blocks go'} with it.`,
                          confirmLabel: 'Delete page',
                          tone: 'danger',
                        }))
                      ) {
                        dispatch('survey.deletePage', { id: page.id })
                      }
                    }}
                    className={`${pageTool} hover:!text-destructive`}
                    aria-label="Delete page"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
            <button
              onClick={() => dispatch('survey.addPage', { page: { blocks: [] } })}
              className="flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md-s border border-dashed border-border text-[13px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <Plus className="h-4 w-4" /> Add a page
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const pageTool =
  'inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md-s text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent'
