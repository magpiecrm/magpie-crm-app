import { LayoutList, Palette, GitBranch, Settings2 } from 'lucide-react'

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

const ITEMS: Array<{ id: SurveyMenu; label: string; icon: typeof LayoutList }> = [
  { id: 'content', label: 'Content', icon: LayoutList },
  { id: 'logic', label: 'Logic', icon: GitBranch },
  { id: 'style', label: 'Style', icon: Palette },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

export function SurveySidebarMenu({ activeMenu, setActiveMenu, setSelectedBlockId, onSelect, logicIssueCount }: SurveySidebarMenuProps) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 h-16 border-t border-border bg-card/95 backdrop-blur flex flex-row items-center justify-around safe-b lg:static lg:h-[calc(100dvh-64px)] lg:w-16 lg:border-t-0 lg:border-r lg:flex-col lg:justify-start lg:py-3 lg:space-y-1.5 lg:backdrop-blur-none shrink-0 select-none lg:sticky lg:top-0">
      {ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => {
            setActiveMenu(id)
            setSelectedBlockId(null)
            onSelect?.()
          }}
          aria-current={activeMenu === id ? 'true' : undefined}
          className={`relative flex h-14 w-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-md-m transition-colors ${
            activeMenu === id ? 'bg-foreground/[0.07] text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <Icon className="h-5 w-5" />
          <span className={`text-[11px] ${activeMenu === id ? 'font-semibold' : 'font-medium'}`}>{label}</span>
          {id === 'logic' && logicIssueCount > 0 && (
            <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-destructive" aria-label={`${logicIssueCount} to fix`} />
          )}
        </button>
      ))}
    </div>
  )
}
