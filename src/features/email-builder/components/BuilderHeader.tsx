import { ArrowLeft, Laptop, Smartphone, Eye, MessageSquare, Save, BookmarkPlus } from 'lucide-react'
import { ThemeToggle } from '../../../components/ui/ThemeToggle'

interface BuilderHeaderProps {
  campaignName: string
  badge: string
  previewMode: 'desktop' | 'mobile'
  setPreviewMode: (mode: 'desktop' | 'mobile') => void
  onClose: () => void
  onSave: () => void
  onPreview: () => void
  onSaveAsTemplate: () => void
  isChatOpen: boolean
  setIsChatOpen: (open: boolean) => void
}

export function BuilderHeader({
  campaignName,
  badge,
  previewMode,
  setPreviewMode,
  onClose,
  onSave,
  onPreview,
  onSaveAsTemplate,
  isChatOpen,
  setIsChatOpen,
}: BuilderHeaderProps) {
  return (
    <div className="h-16 border-b border-border bg-card px-2 sm:px-6 flex justify-between items-center gap-2 shrink-0">
      <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
        <button onClick={onClose} aria-label="Close builder" className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <h2 className="text-sm font-bold truncate text-foreground">{campaignName}</h2>
          <span className="hidden sm:inline text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{badge}</span>
        </div>
      </div>

      {/* Viewport controls and final actions */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        <span className="hidden sm:inline-flex"><ThemeToggle /></span>
        <div className="flex border border-border rounded-lg p-0.5 bg-muted">
          <button 
            onClick={() => setPreviewMode('desktop')} 
            aria-label="Desktop preview"
            className={`p-1.5 rounded-md transition-colors ${previewMode === 'desktop' ? 'bg-card text-accent shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Laptop className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setPreviewMode('mobile')} 
            aria-label="Mobile preview"
            className={`p-1.5 rounded-md transition-colors ${previewMode === 'mobile' ? 'bg-card text-accent shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Smartphone className="w-4 h-4" />
          </button>
        </div>

        <button 
          onClick={onPreview} 
          aria-label="Preview & Test"
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 border border-border rounded-lg text-xs font-semibold hover:bg-muted transition-colors text-foreground"
        >
          <Eye className="w-4 h-4" />
          <span className="hidden lg:inline">Preview & Test</span>
        </button>

        <button
          onClick={onSaveAsTemplate}
          aria-label="Save as template"
          title="Save as template"
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 border border-border rounded-lg text-xs font-semibold hover:bg-muted transition-colors text-foreground"
        >
          <BookmarkPlus className="w-4 h-4" />
          <span className="hidden xl:inline">Save as template</span>
        </button>

        <button
          onClick={() => setIsChatOpen(!isChatOpen)}
          aria-label="AI Copilot"
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 border rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            isChatOpen
              ? 'bg-accent/15 border-accent/20 text-accent hover:bg-accent/25'
              : 'border-border bg-card text-foreground hover:bg-muted'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span className="hidden lg:inline">AI Copilot</span>
        </button>

        <button
          onClick={onSave}
          aria-label="Save & quit"
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 sm:px-4 py-2 rounded-lg text-xs font-bold hover:bg-primary/85 active:scale-95 transition-all shadow-sm/15"
        >
          <Save className="w-4 h-4" />
          <span className="hidden sm:inline">Save & quit</span>
        </button>
      </div>
    </div>
  )
}
