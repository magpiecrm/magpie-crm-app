import { useState } from 'react'
import { Check, Eye, Plus } from 'lucide-react'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { TemplateThumbnail } from './TemplateThumbnail'
import { withSampleValues } from '../preview'

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
            <div className="flex aspect-[4/5] flex-col items-center justify-center gap-2 bg-card text-muted-foreground">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-accent/10 text-accent">
                <Plus aria-hidden className="h-5 w-5" />
              </span>
              <span className="text-[13px]">Start from nothing</span>
            </div>
          ) : (
            <TemplateThumbnail html={html ?? ''} className="aspect-[4/5]" />
          )}
          {selected && (
            <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-foreground shadow-sm">
              <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
          )}
        </div>
        <div className="mt-2.5">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground" title={name}>
            {name}
          </p>
          {description && <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">{description}</p>}
        </div>
      </button>
      {onPreview && <PreviewButton name={name} onClick={onPreview} />}
    </div>
  )
}

/** The eye on a picture's corner: shown on pointing or focus, always on a touch screen. */
function PreviewButton({ name, onClick, className = 'right-2 top-2' }: { name: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Preview ${name}`}
      title="Preview"
      className={`absolute grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-border bg-popover text-foreground shadow-sm transition-[opacity,background-color] hover:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 ${className}`}
    >
      <Eye aria-hidden className="h-4 w-4" />
    </button>
  )
}

/**
 * One email design as a row, for narrow panels: a small picture, then its
 * name and a line about it. Clicking it uses it.
 */
export function TemplateRow({ html, name, description, onSelect }: { html: string; name: string; description?: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full cursor-pointer items-start gap-3 rounded-md-m p-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="w-[84px] shrink-0 overflow-hidden rounded-md-s border border-border transition-colors group-hover:border-foreground/25 dark:border-white/10">
        <TemplateThumbnail html={html} className="aspect-[4/5]" inset={6} />
      </div>
      <span className="min-w-0 pt-1">
        <span className="line-clamp-2 block text-sm font-medium leading-snug text-foreground" title={name}>
          {name}
        </span>
        {description && <span className="mt-1 line-clamp-3 block text-[13px] leading-snug text-muted-foreground">{description}</span>}
      </span>
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
  return (
    <Dialog isOpen onClose={onClose} title={name} description={description || undefined} className="sm:max-w-[760px]">
      <DialogBody className="!px-0 !pb-0">
        <iframe
          title={`${name}, full preview`}
          srcDoc={withSampleValues(html)}
          // Same origin only so its height can be read; with no allow-scripts nothing in it runs.
          sandbox="allow-same-origin"
          onLoad={(e) => {
            const doc = e.currentTarget.contentDocument
            if (doc) setHeight(Math.max(320, doc.documentElement.scrollHeight))
          }}
          className="block w-full border-0 bg-white"
          style={{ height }}
        />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
        {onAction && actionLabel && (
          <Button type="button" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
