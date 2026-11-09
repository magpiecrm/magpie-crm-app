import { useState } from 'react'
import { Check, Eye, Monitor, Plus, Smartphone } from 'lucide-react'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { TemplateThumbnail } from './TemplateThumbnail'
import { withSampleValues } from '../preview'
import { SegmentedTabs } from './SegmentedTabs'

/**
 * One email design in a gallery: its picture, then its name and a line about
 * it. Clicking picks it; a double click (or `onActivate`) uses it straight
 * away. The eye opens the whole email. `selected` draws the accent ring and a
 * check, for galleries where you pick first and confirm after.
 */
export function TemplateTile({
  html,
  name,
  description,
  selected,
  onSelect,
  onActivate,
  onPreview,
  blank,
  shape = 'aspect-[4/5]',
}: {
  html?: string
  name: string
  description?: string
  selected?: boolean
  onSelect: () => void
  onActivate?: () => void
  onPreview?: () => void
  /** The empty canvas, drawn as a blank sheet. */
  blank?: boolean
  /** The picture's aspect-ratio classes. */
  shape?: string
}) {
  const edge = selected
    ? 'border-accent ring-2 ring-accent'
    : blank
      ? 'border-dashed border-foreground/25 group-hover:border-foreground/40'
      : 'border-border group-hover:border-foreground/25 dark:border-white/10'
  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onActivate}
        aria-pressed={selected === undefined ? undefined : selected}
        className="block w-full cursor-pointer rounded-md-m text-left focus-visible:outline-none focus-visible:[&>div:first-child]:ring-2 focus-visible:[&>div:first-child]:ring-ring/50"
      >
        <div className={`relative overflow-hidden rounded-md-m border transition-[border-color,box-shadow] ${edge}`}>
          {blank ? (
            <div className={`flex ${shape} flex-col items-center justify-center gap-2 bg-card text-muted-foreground`}>
              <span className="grid h-10 w-10 place-items-center rounded-full bg-accent/10 text-accent">
                <Plus aria-hidden className="h-5 w-5" />
              </span>
            </div>
          ) : (
            <TemplateThumbnail html={html ?? ''} className={shape} />
          )}
          {selected && (
            <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-foreground shadow-sm">
              <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
          )}
        </div>
        <div className="mt-2.5">
          {/* Room on the right for Preview, which sits at the end of this line. */}
          <p className={`line-clamp-2 text-sm font-medium leading-snug text-foreground ${onPreview ? 'pr-9' : ''}`} title={name}>
            {name}
          </p>
          {description && <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">{description}</p>}
        </div>
      </button>
      {onPreview && (
        // A box the picture's size, so Preview lines up with the name just under it.
        <div className="pointer-events-none absolute inset-x-0 top-0">
          <div className={shape} />
          <PreviewButton name={name} onClick={onPreview} className="absolute right-0 mt-1.5" />
        </div>
      )}
    </div>
  )
}

/** Preview: an eye beside a template's name, never over the email itself. */
export function PreviewButton({ name, onClick, className = '' }: { name: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Preview ${name}`}
      title="Preview"
      className={`pointer-events-auto grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${className}`}
    >
      <Eye aria-hidden className="h-[18px] w-[18px]" />
    </button>
  )
}

/**
 * The whole email, scrolled inside a pop-up, before you use it. The frame is
 * sized to the email once it has loaded (no scripts run in it).
 */
export function TemplatePreviewDialog({
  html,
  name,
  description,
  onClose,
  actionLabel,
  onAction,
}: {
  html: string
  name: string
  description?: string
  onClose: () => void
  actionLabel?: string
  onAction?: () => void
}) {
  const [height, setHeight] = useState(640)
  const [view, setView] = useState<'desktop' | 'mobile'>('desktop')
  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={name}
      description={description || undefined}
      className="sm:max-w-[760px]"
      headerActions={
        <SegmentedTabs
          label="Preview size"
          value={view}
          onChange={setView}
          className="max-sm:hidden"
          options={[
            { value: 'desktop', label: <span className="inline-flex items-center gap-1.5"><Monitor aria-hidden className="h-3.5 w-3.5" />Desktop</span> },
            { value: 'mobile', label: <span className="inline-flex items-center gap-1.5"><Smartphone aria-hidden className="h-3.5 w-3.5" />Mobile</span> },
          ]}
        />
      }
    >
      <DialogBody className="!px-0 !pb-0">
        <div className={view === 'mobile' ? 'flex justify-center bg-muted py-6' : ''}>
          <iframe
            key={view}
            title={`${name}, full preview`}
            srcDoc={withSampleValues(html)}
            // Same origin only so its height can be read; with no allow-scripts nothing in it runs.
            sandbox="allow-same-origin"
            onLoad={(e) => {
              const doc = e.currentTarget.contentDocument
              if (doc) setHeight(Math.max(320, doc.documentElement.scrollHeight))
            }}
            className={`block border-0 bg-white ${view === 'mobile' ? 'w-[375px] rounded-xl shadow-[0_0_0_1px_rgb(17_19_22/0.08),0_8px_24px_-8px_rgb(17_19_22/0.25)]' : 'w-full'}`}
            style={{ height, colorScheme: 'light' }}
          />
        </div>
      </DialogBody>
      {onAction && actionLabel && (
        <DialogFooter>
          <Button type="button" onClick={onAction}>
            {actionLabel}
          </Button>
        </DialogFooter>
      )}
    </Dialog>
  )
}
