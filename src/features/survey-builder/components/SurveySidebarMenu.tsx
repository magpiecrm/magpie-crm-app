import { Layout, Compass, GitBranch, Settings2 } from 'lucide-react'

export type SurveyMenu = 'content' | 'logic' | 'style' | 'settings'

interface SurveySidebarMenuProps {
  activeMenu: SurveyMenu
  setActiveMenu: (menu: SurveyMenu) => void
  setSelectedBlockId: (id: string | null) => void
  /** Below lg the panel is a sheet, so picking a tab must also open it. */
  onSelect?: () => void
  /** Shown as a dot on the Logic item when lint finds problems. */
  logicIssueCount: number
}

const ITEMS: Array<{ id: SurveyMenu; label: string; icon: typeof Layout }> = [
  { id: 'content', label: 'Content', icon: Layout },
  { id: 'logic', label: 'Logic', icon: GitBranch },
  { id: 'style', label: 'Style', icon: Compass },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

export function SurveySidebarMenu({ activeMenu, setActiveMenu, setSelectedBlockId, onSelect, logicIssueCount }: SurveySidebarMenuProps) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 h-16 border-t border-border bg-card/95 backdrop-blur flex flex-row items-center justify-around safe-b lg:static lg:h-[calc(100dvh-64px)] lg:w-16 lg:border-t-0 lg:border-r lg:flex-col lg:justify-start lg:py-4 lg:space-y-4 lg:backdrop-blur-none shrink-0 select-none lg:sticky lg:top-0">
      {ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => {
            setActiveMenu(id)
            setSelectedBlockId(null)
            onSelect?.()
          }}
          className={`relative w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-all ${
            activeMenu === id ? 'bg-accent/15 text-accent font-bold' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <Icon className="w-5 h-5" />
          <span className="text-[9px]">{label}</span>
          {id === 'logic' && logicIssueCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500" aria-label={`${logicIssueCount} issues`} />
          )}
        </button>
      ))}
    </div>
  )
}
