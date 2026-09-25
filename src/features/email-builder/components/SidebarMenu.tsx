import { Layout, Compass } from 'lucide-react'

interface SidebarMenuProps {
  activeMenu: 'content' | 'style'
  setActiveMenu: (menu: 'content' | 'style') => void
  setSelectedBlockId: (id: string | null) => void
  /** Below lg the panel is a sheet, so picking a tab must also open it. */
  onSelect?: () => void
}

export function SidebarMenu({ activeMenu, setActiveMenu, setSelectedBlockId, onSelect }: SidebarMenuProps) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 h-16 border-t border-border bg-card/95 backdrop-blur flex flex-row items-center justify-around safe-b lg:static lg:h-[calc(100dvh-64px)] lg:w-16 lg:border-t-0 lg:border-r lg:flex-col lg:justify-start lg:py-4 lg:space-y-4 lg:backdrop-blur-none shrink-0 select-none lg:sticky lg:top-0">
      <button 
        onClick={() => { setActiveMenu('content'); setSelectedBlockId(null); onSelect?.() }}
        className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-all ${
          activeMenu === 'content' ? 'bg-accent/15 text-accent font-bold' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        }`}
      >
        <Layout className="w-5 h-5" />
        <span className="text-[9px]">Content</span>
      </button>
      <button 
        onClick={() => { setActiveMenu('style'); setSelectedBlockId(null); onSelect?.() }}
        className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-all ${
          activeMenu === 'style' ? 'bg-accent/15 text-accent font-bold' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        }`}
      >
        <Compass className="w-5 h-5" />
        <span className="text-[9px]">Style</span>
      </button>
    </div>
  )
}
