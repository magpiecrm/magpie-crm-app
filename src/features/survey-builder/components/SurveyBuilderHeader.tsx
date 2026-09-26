import { ArrowLeft, Laptop, Smartphone, Eye, MessageSquare, Save, Rocket, Loader2 } from 'lucide-react'
import { ThemeToggle } from '../../../components/ui/ThemeToggle'
import type { SurveyStatus } from '../types'
import { SurveyStatusBadge } from '../../surveys/components/SurveyStatusBadge'

interface SurveyBuilderHeaderProps {
  name: string
  setName: (name: string) => void
  status: SurveyStatus
  previewMode: 'desktop' | 'mobile'
  setPreviewMode: (mode: 'desktop' | 'mobile') => void
  onClose: () => void
  onSave: () => void
  onPublish: () => void
  onPreview: () => void
  isSaving: boolean
  isDirty: boolean
  isChatOpen: boolean
  setIsChatOpen: (open: boolean) => void
}

export function SurveyBuilderHeader({
  name,
  setName,
  status,
  previewMode,
  setPreviewMode,
  onClose,
  onSave,
  onPublish,
  onPreview,
  isSaving,
  isDirty,
  isChatOpen,
  setIsChatOpen,
}: SurveyBuilderHeaderProps) {
  return (
    <div className="h-16 border-b border-border bg-card px-2 sm:px-6 flex justify-between items-center gap-2 shrink-0">
      <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
        <button onClick={onClose} aria-label="Close builder" className="p-2 hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            aria-label="Survey name"
            className="text-sm font-bold text-foreground bg-transparent border border-transparent hover:border-border focus:border-border rounded px-1.5 py-1 min-w-0 flex-1 max-w-xs focus:outline-none"
          />
          <span className="hidden sm:inline-flex">
            <SurveyStatusBadge status={status} />
          </span>
          {isDirty && <span className="hidden md:inline text-[10px] text-muted-foreground">Unsaved changes</span>}
        </div>
      </div>

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
          aria-label="Preview"
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 border border-border rounded-lg text-xs font-semibold hover:bg-muted transition-colors text-foreground"
        >
          <Eye className="w-4 h-4" />
          <span className="hidden lg:inline">Preview</span>
        </button>

        <button
          onClick={() => setIsChatOpen(!isChatOpen)}
          aria-label="AI Copilot"
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 border rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            isChatOpen ? 'bg-accent/15 border-accent/20 text-accent hover:bg-accent/25' : 'border-border bg-card text-foreground hover:bg-muted'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span className="hidden lg:inline">AI Copilot</span>
        </button>

        <button
          onClick={onSave}
          disabled={isSaving}
          aria-label="Save"
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 border border-border rounded-lg text-xs font-semibold hover:bg-muted transition-colors text-foreground disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span className="hidden sm:inline">Save</span>
        </button>

        {status !== 'published' && (
          <button
            onClick={onPublish}
            disabled={isSaving}
            aria-label="Publish"
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 sm:px-4 py-2 rounded-lg text-xs font-bold hover:bg-primary/85 active:scale-95 transition-all shadow-sm/15 disabled:opacity-50"
          >
            <Rocket className="w-4 h-4" />
            <span className="hidden sm:inline">Publish</span>
          </button>
        )}
      </div>
    </div>
  )
}
