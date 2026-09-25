import type React from 'react'
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  AtSign,
  Calendar,
  CheckSquare,
  ChevronDownSquare,
  CircleDot,
  Code,
  Gauge,
  Hash,
  Heading,
  Image,
  Maximize2,
  Minus,
  Plus,
  SlidersHorizontal,
  Star,
  ThumbsUp,
  Trash2,
  Type,
} from 'lucide-react'
import type { DragPayload } from '../../email-builder/hooks/useBlockDrag'
import type { ContactFieldDef } from '../../contacts/contactFields'
import type { SurveyBlock, SurveyBlockType, SurveyDesign, SurveySettings, SurveyTheme } from '../types'
import { SURVEY_BLOCK_TYPES } from '../types'
import type { SurveyStarterTemplate } from '../templates/starters'
import type { LintIssue } from '../logic/lint'
import type { SurveyMenu } from './SurveySidebarMenu'
import type { Dispatch } from './SurveyBlockEditor'
import { SurveyBlockEditor, inputClass } from './SurveyBlockEditor'
import { SurveyThemeEditor } from './SurveyThemeEditor'
import { LogicEditor } from './LogicEditor'
import { SurveySettingsPanel } from './SurveySettingsPanel'

/** Palette icons, keyed by the catalogue so a new type can't be missing one. */
const SURVEY_BLOCK_ICONS: Record<SurveyBlockType, React.ReactNode> = {
  heading: <Heading className="w-5 h-5" />,
  text: <Type className="w-5 h-5" />,
  image: <Image className="w-5 h-5" />,
  divider: <Minus className="w-5 h-5" />,
  spacer: <Maximize2 className="w-5 h-5" />,
  html: <Code className="w-5 h-5" />,
  short_text: <Type className="w-5 h-5" />,
  long_text: <AlignLeft className="w-5 h-5" />,
  email: <AtSign className="w-5 h-5" />,
  number: <Hash className="w-5 h-5" />,
  date: <Calendar className="w-5 h-5" />,
  single_choice: <CircleDot className="w-5 h-5" />,
  multiple_choice: <CheckSquare className="w-5 h-5" />,
  dropdown: <ChevronDownSquare className="w-5 h-5" />,
  rating: <Star className="w-5 h-5" />,
  nps: <Gauge className="w-5 h-5" />,
  scale: <SlidersHorizontal className="w-5 h-5" />,
  yes_no: <ThumbsUp className="w-5 h-5" />,
}

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
      {activeMenu === 'logic' && <LogicEditor design={design} dispatch={dispatch} issues={issues} />}
      {activeMenu === 'style' && (
        <SurveyThemeEditor theme={design.theme} setTheme={(updates: Partial<SurveyTheme>) => dispatch('survey.setTheme', { updates })} />
      )}
      {activeMenu === 'settings' && <SurveySettingsPanel settings={settings} setSettings={setSettings} />}
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
}: SurveySidebarPanelProps) {
  const groups = [
    { label: 'Questions', items: SURVEY_BLOCK_TYPES.filter(t => t.isQuestion) },
    { label: 'Content', items: SURVEY_BLOCK_TYPES.filter(t => !t.isQuestion) },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex border-b border-border select-none bg-muted/15 shrink-0">
        {(['blocks', 'templates', 'pages'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => {
              setContentTab(tab)
              setSelectedBlockId(null)
            }}
            className={`flex-1 py-2.5 text-[11px] font-semibold border-b-2 capitalize transition-colors ${
              contentTab === tab && !selectedBlock ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {selectedBlock ? (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="flex justify-between items-center pb-2 border-b border-border/60">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Edit Block</h3>
              <button onClick={() => setSelectedBlockId(null)} className="text-[10px] text-accent hover:underline font-semibold">
                Back to blocks
              </button>
            </div>
            <SurveyBlockEditor
              block={selectedBlock}
              dispatch={dispatch}
              locked={lockedBlockIds.has(selectedBlock.id)}
              lockedOptionIds={lockedOptionIds}
              contactFields={contactFields}
            />
          </div>
        ) : contentTab === 'blocks' ? (
          <div className="space-y-5 animate-in fade-in duration-200">
            <p className="text-[10px] text-muted-foreground/80 leading-snug">
              Drag onto a page, or click to add to the selected page.
            </p>
            {groups.map(group => (
              <div key={group.label}>
                <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">{group.label}</span>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-2 gap-2 mt-2 select-none">
                  {group.items.map(item => (
                    <button
                      key={item.type}
                      title={item.description}
                      onClick={() => {
                        // A completed drag already inserted the block.
                        if (didDrag.current) return
                        addBlock(item.type)
                      }}
                      onPointerDown={e => startDrag(e, { kind: 'new', blockType: item.type })}
                      className="p-3 bg-muted/30 border border-border/80 hover:border-accent/40 rounded-xl flex flex-col items-center justify-center gap-1.5 text-center transition-all hover:bg-accent/5 hover:text-accent group text-xs font-semibold cursor-grab active:cursor-grabbing touch-none"
                    >
                      <div className="text-muted-foreground group-hover:text-accent transition-colors">{SURVEY_BLOCK_ICONS[item.type]}</div>
                      <span className="text-[10px] leading-tight truncate w-full">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : contentTab === 'templates' ? (
          <div className="space-y-4 animate-in fade-in duration-200">
            <p className="text-[10px] text-muted-foreground/80 leading-snug">Applying a template replaces every page.</p>
            {(['Feedback', 'Research', 'Lead gen'] as const).map(category => {
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
        ) : (
          <div className="space-y-2 animate-in fade-in duration-200">
            {design.pages.map((page, i) => {
              const hasLocked = page.blocks.some(b => lockedBlockIds.has(b.id))
              return (
                <div
                  key={page.id}
                  onClick={() => setSelectedPageId(page.id)}
                  className={`p-2.5 rounded-xl border flex items-center gap-1.5 cursor-pointer ${
                    selectedPageId === page.id ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/40'
                  }`}
                >
                  <span className="text-[10px] font-bold text-muted-foreground w-5 shrink-0">{i + 1}</span>
                  <input
                    value={page.title ?? ''}
                    placeholder={`Page ${i + 1}`}
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
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move page up"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    disabled={i === design.pages.length - 1}
                    onClick={e => {
                      e.stopPropagation()
                      dispatch('survey.movePage', { id: page.id, direction: 'down' })
                    }}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Move page down"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    disabled={design.pages.length <= 1 || hasLocked}
                    title={hasLocked ? 'This page has questions with responses' : 'Delete page'}
                    onClick={e => {
                      e.stopPropagation()
                      if (page.blocks.length === 0 || confirm(`Delete ${page.title || `page ${i + 1}`} and its ${page.blocks.length} block(s)?`)) {
                        dispatch('survey.deletePage', { id: page.id })
                      }
                    }}
                    className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                    aria-label="Delete page"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )
            })}
            <button
              onClick={() => dispatch('survey.addPage', { page: { blocks: [] } })}
              className="w-full py-2 border border-dashed border-border rounded-xl text-xs font-semibold text-muted-foreground hover:text-accent hover:border-accent/50 flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add page
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
