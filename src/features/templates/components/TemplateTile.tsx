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
  shape = 'aspect-[4/5]',
  fromTop,
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
  /** Fill a wide picture from the email's top (`TemplateThumbnail` `top`). */
  fromTop?: boolean
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
            <TemplateThumbnail html={html ?? ''} className={shape} top={fromTop} />
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
      {onPreview && (
        // A box the picture's size and place, so Preview sits in its corner.
        <div className={`pointer-events-none absolute inset-x-0 top-0 ${shape}`}>
          <PreviewButton name={name} onClick={onPreview} />
        </div>
      )}
    </div>
  )
}

/** Preview, always on a picture's bottom corner, so it's found without pointing at anything. */
function PreviewButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Preview ${name}`}
      className="pointer-events-auto absolute bottom-2 right-2 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-popover/95 pl-2.5 pr-3 text-[13px] font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Eye aria-hidden className="h-4 w-4 text-muted-foreground" />
      Preview
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
