import { ArrowLeft, Check, Eye, Laptop, MessageSquare, Rocket, Save, Share2, Smartphone } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
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
  onShare: () => void
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
  onShare,
}: SurveyBuilderHeaderProps) {
  const live = status === 'published'
  const device = (mode: 'desktop' | 'mobile', label: string, Icon: typeof Laptop) => (
    <button
      type="button"
      onClick={() => setPreviewMode(mode)}
      aria-label={label}
      aria-pressed={previewMode === mode}
      title={label}
      className={`inline-flex h-8 w-9 cursor-pointer items-center justify-center rounded-md-xs transition-colors ${
        previewMode === mode ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.08)] dark:bg-white/10' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  )

  return (
    <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-2 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-3">
        <button
          onClick={onClose}
          aria-label="Back to the survey's results"
          title="Back to results"
          className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md-s text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {/* On a phone, two lines: the name, then its status and whether it's saved. */}
        <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            aria-label="Survey name"
            title="Rename the survey"
            style={{ width: `${Math.min(Math.max(name.length + 2, 10), 40)}ch` }}
            className="min-w-0 max-w-full text-ellipsis rounded-md-s border border-transparent bg-transparent px-2 py-1 text-[15px] font-semibold text-foreground transition-colors hover:border-border focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/20 sm:py-1.5"
          />
          <span className="flex min-w-0 items-center gap-2 px-2 sm:px-0">
            <span className="shrink-0">
              <SurveyStatusBadge status={status} />
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground max-md:[&>svg]:hidden sm:text-[13px]" aria-live="polite">
                {isSaving ? (
            'Saving…'
          ) : isDirty ? (
            <>
              <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
              {live ? 'Changes not live yet' : 'Unsaved changes'}
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {live ? 'Respondents see this version' : 'Saved'}
            </>
          )}
            </span>
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <div role="group" aria-label="Show it as on" className="hidden gap-0.5 rounded-md-s bg-muted p-0.5 lg:flex">
          {device('desktop', 'A computer', Laptop)}
          {device('mobile', 'A phone', Smartphone)}
        </div>
        <Button variant="secondary" onClick={onPreview} leftIcon={<Eye className="h-4 w-4" />} aria-label="Preview" className="max-lg:!px-2.5">
          <span className="max-lg:hidden">Preview</span>
        </Button>
        <Button
          variant="secondary"
          onClick={() => setIsChatOpen(!isChatOpen)}
          aria-pressed={isChatOpen}
          aria-label="AI Copilot"
          leftIcon={<MessageSquare className="h-4 w-4" />}
          className={`max-lg:!px-2.5 ${isChatOpen ? '!border-accent/40 !bg-accent/10' : ''}`}
        >
          <span className="max-lg:hidden">AI Copilot</span>
        </Button>
        {live ? (
          // A live survey changes for respondents as soon as it's saved, so saving is publishing.
          isDirty ? (
            <Button onClick={onSave} isLoading={isSaving} leftIcon={<Rocket className="h-4 w-4" />} aria-label="Publish changes" className="max-sm:!px-2.5">
              <span className="max-sm:hidden">Publish changes</span>
            </Button>
          ) : (
            <Button onClick={onShare} leftIcon={<Share2 className="h-4 w-4" />} aria-label="Share" className="max-sm:!px-2.5">
              <span className="max-sm:hidden">Share</span>
            </Button>
          )
        ) : (
          <>
            {isDirty && (
              <Button variant="secondary" onClick={onSave} disabled={isSaving} leftIcon={<Save className="h-4 w-4" />} aria-label="Save draft" className="max-sm:!px-2.5">
                <span className="max-sm:hidden">Save draft</span>
              </Button>
            )}
            <Button onClick={onPublish} disabled={isSaving} leftIcon={<Rocket className="h-4 w-4" />} aria-label={status === 'closed' ? 'Reopen' : 'Publish'} className="max-sm:!px-2.5">
              <span className="max-sm:hidden">{status === 'closed' ? 'Save and reopen' : 'Publish'}</span>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
