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
  size = 'md',
  blank,
}: {
  html?: string
  name: string
  description?: string
  selected?: boolean
  onSelect: () => void
  onActivate?: () => void
  onPreview?: () => void
  size?: 'sm' | 'md'
  /** The empty canvas, drawn as a blank sheet. */
  blank?: boolean
}) {
  const sm = size === 'sm'
  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onActivate}
        aria-pressed={selected === undefined ? undefined : selected}
        className="block w-full cursor-pointer rounded-md-m text-left focus-visible:outline-none focus-visible:[&>div:first-child]:ring-2 focus-visible:[&>div:first-child]:ring-ring/50"
      >
        <div
          className={`relative overflow-hidden rounded-md-m border transition-[border-color,box-shadow] ${
            selected ? 'border-accent ring-2 ring-accent' : 'border-border group-hover:border-foreground/25'
          }`}
        >
          {blank ? (
            <div className={`relative bg-muted dark:bg-[#202328] ${sm ? 'aspect-[4/5]' : 'aspect-[4/5]'}`}>
              <div className={`absolute bottom-0 flex flex-col items-center justify-center gap-2 rounded-t-[5px] border border-b-0 border-dashed border-foreground/20 bg-card/70 text-muted-foreground ${sm ? 'left-2.5 right-2.5 top-2.5' : 'left-4 right-4 top-4'}`}>
                <Plus aria-hidden className={sm ? 'h-5 w-5' : 'h-6 w-6'} />
                {!sm && <span className="text-[13px]">Empty canvas</span>}
              </div>
            </div>
          ) : (
            <TemplateThumbnail html={html ?? ''} className="aspect-[4/5]" inset={sm ? 'sm' : 'md'} />
          )}
          {selected && (
            <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-foreground shadow-sm">
              <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
          )}
        </div>
        <span className={`block ${sm ? 'mt-1.5' : 'mt-2.5'}`}>
          <span className={`block truncate font-medium text-foreground ${sm ? 'text-[13px]' : 'text-sm'}`} title={name}>
            {name}
          </span>
          {description && !sm && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">{description}</span>}
        </span>
      </button>
      {onPreview && (
        <button
          type="button"
          onClick={onPreview}
          aria-label={`Preview ${name}`}
          title="Preview"
          className={`absolute grid place-items-center rounded-md-xs border border-border bg-popover/95 text-foreground shadow-sm transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 ${
            sm ? 'right-1.5 top-1.5 h-7 w-7' : 'right-2.5 top-2.5 h-8 w-8'
          }`}
        >
          <Eye aria-hidden className="h-4 w-4" />
        </button>
      )}
    </div>
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
