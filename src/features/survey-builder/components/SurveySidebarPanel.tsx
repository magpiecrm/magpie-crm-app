import type React from 'react'
import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { ActionMenu } from '../../../components/ui/ActionMenu'
import type { DragPayload } from '../../email-builder/hooks/useBlockDrag'
import type { ContactFieldDef } from '../../contacts/contactFields'
import type { SurveyBlock, SurveyBlockType, SurveyDesign, SurveySettings, SurveyTheme } from '../types'
import { SURVEY_BLOCK_TYPES, isQuestionType } from '../types'
import type { SurveyStarterTemplate } from '../templates/starters'
import type { LintIssue } from '../logic/lint'
import type { SurveyMenu } from './SurveySidebarMenu'
import type { Dispatch } from './SurveyBlockEditor'
import { SurveyBlockEditor, hintClass, inputClass, sectionLabelClass } from './SurveyBlockEditor'
import { BlockChip } from '../blockIcons'
import { QuestionPicker } from './QuestionPicker'
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
  /** Which block is selected, even while its settings are open elsewhere (the wide screen's right column). */
  selectedBlockId: string | null
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
  selectedBlockId,
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
  const numbers = new Map<string, number>()
  let count = 0
  for (const p of design.pages) for (const b of p.blocks) if (isQuestionType(b.type)) numbers.set(b.id, ++count)

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

  const tabs: Array<{ id: SurveyContentTab; label: string; count?: number }> = [
    { id: 'pages', label: 'Outline' },
    { id: 'blocks', label: 'Add' },
    { id: 'templates', label: 'Templates' },
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
            className={`relative inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-[13px] font-medium transition-colors ${
              contentTab === tab.id ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && <span className="rounded-full bg-foreground/[0.07] px-1.5 text-xs font-medium tabular-nums text-foreground/80">{tab.count}</span>}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {contentTab === 'blocks' ? (
          <div className="space-y-5">
            <QuestionPicker onPick={addBlock} startDrag={startDrag} didDrag={didDrag} />
            <p className={hintClass}>Click one to add it to the end of the page you're on, drag it to where it should go, or use the + between questions on the page.</p>
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
              const rules = page.rules?.length ?? 0
              return (
                <div key={page.id} className="space-y-1">
                <PageRow
                  page={page}
                  index={i}
                  count={design.pages.length}
                  selected={selectedPageId === page.id}
                  hasLocked={hasLocked}
                  rules={rules}
                  onSelect={() => setSelectedPageId(page.id)}
                  dispatch={dispatch}
                />
                {/* The page's questions, as the outline of the survey: click one to change it. */}
                <ul className="ml-3 border-l border-border pl-2">
                  {page.blocks.filter(b => isQuestionType(b.type)).map(b => {
                    const n = numbers.get(b.id) ?? 0
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => (setSelectedPageId(page.id), setSelectedBlockId(b.id))}
                          aria-current={selectedBlockId === b.id ? 'true' : undefined}
                          className={`flex w-full cursor-pointer items-center gap-2 rounded-md-s px-1.5 py-1.5 text-left text-[13px] text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                            selectedBlockId === b.id ? 'bg-accent/10 font-medium ring-1 ring-inset ring-accent/50' : 'hover:bg-muted/70'
                          }`}
                        >
                          <BlockChip type={b.type} label={`Q${n}`} size="sm" />
                          <span className="min-w-0 flex-1 truncate">{b.question?.title || 'Untitled question'}</span>
                        </button>
                      </li>
                    )
                  })}
                  {!page.blocks.some(b => isQuestionType(b.type)) && <li className="px-1.5 py-1.5 text-[13px] text-muted-foreground">No questions yet</li>}

                </ul>
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

/**
 * A page in the outline: its number and name as text, its rule count, and a
 * "…" menu to rename, move or delete it. Renaming swaps the name for a field.
 */
function PageRow({ page, index, count, selected, hasLocked, rules, onSelect, dispatch }: { page: SurveyDesign['pages'][number]; index: number; count: number; selected: boolean; hasLocked: boolean; rules: number; onSelect: () => void; dispatch: SurveySidebarPanelProps['dispatch'] }) {
  const [renaming, setRenaming] = useState(false)
  const name = page.title || `Page ${index + 1}`
  const remove = async () => {
    const n = page.blocks.length
    if (n === 0 || (await confirmDialog({ title: `Delete ${page.title ? `“${page.title}”` : `page ${index + 1}`}?`, message: `Its ${n} ${n === 1 ? 'block goes' : 'blocks go'} with it.`, confirmLabel: 'Delete page', tone: 'danger' }))) {
      dispatch('survey.deletePage', { id: page.id })
    }
  }
  return (
    <div className={`group/page flex items-center gap-1 rounded-md-s py-1 pl-2 pr-1 ${selected ? 'bg-foreground/[0.06]' : 'hover:bg-muted/60'}`}>
      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] px-1 text-[11px] font-semibold tabular-nums text-foreground">{index + 1}</span>
      {renaming ? (
        <input
          autoFocus
          defaultValue={page.title ?? ''}
          placeholder={`Page ${index + 1}`}
          aria-label={`Name of page ${index + 1}`}
          onBlur={e => (dispatch('survey.updatePage', { id: page.id, updates: { title: e.target.value.trim() || undefined } }), setRenaming(false))}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setRenaming(false)
          }}
          className={inputClass}
        />
      ) : (
        <button type="button" onClick={onSelect} onDoubleClick={() => setRenaming(true)} className="min-w-0 flex-1 cursor-pointer truncate py-1 text-left text-[13px] font-semibold text-foreground" title="Double-click to rename">
          {name}
        </button>
      )}
      {!renaming && rules > 0 && <span className="shrink-0 rounded-full bg-accent/10 px-1.5 text-xs font-medium text-foreground">{rules} rule{rules === 1 ? '' : 's'}</span>}
      {!renaming && (
        <ActionMenu
          label={`Actions for ${name}`}
          width={180}
          triggerClassName="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted"
          items={[
            { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(true) },
            { label: 'Move up', icon: ArrowUp, onSelect: () => dispatch('survey.movePage', { id: page.id, direction: 'up' }), disabled: index === 0 },
            { label: 'Move down', icon: ArrowDown, onSelect: () => dispatch('survey.movePage', { id: page.id, direction: 'down' }), disabled: index === count - 1 },
            'separator',
            { label: hasLocked ? 'Has responses: can’t delete' : 'Delete page', icon: Trash2, tone: 'danger', onSelect: remove, disabled: count <= 1 || hasLocked },
          ]}
        />
      )}
    </div>
  )
}
