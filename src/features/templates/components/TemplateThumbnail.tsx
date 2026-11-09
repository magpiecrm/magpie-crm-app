import { useLayoutEffect, useRef, useState } from 'react'
import { withSampleValues } from '../preview'

/** The width an email is laid out at before it's shrunk: a little over the usual 600px body, so its canvas shows at the sides. */
const RENDER_WIDTH = 680

/**
 * A scaled-down, non-interactive picture of an email: the email laid out at
 * desktop width in a sandboxed iframe (no scripts, no navigation), shrunk to
 * fit, and set on a neutral backdrop like a sheet of paper, so every
 * thumbnail is framed the same way whatever the email's own background.
 *
 * The frame's shape comes from `className` (e.g. `aspect-[4/3]`).
 */
export function TemplateThumbnail({ html, className = '', inset = 'md' }: { html: string; className?: string; inset?: 'sm' | 'md' }) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState<number | null>(null)

  useLayoutEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const measure = () => setScale(sheet.clientWidth / RENDER_WIDTH)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(sheet)
    return () => observer.disconnect()
  }, [])

  const pad = inset === 'sm' ? 'left-2.5 right-2.5 top-2.5' : 'left-4 right-4 top-4'
  return (
    <div className={`relative overflow-hidden bg-muted dark:bg-[#202328] ${className}`}>
      <div
        ref={sheetRef}
        className={`absolute bottom-0 ${pad} overflow-hidden rounded-t-[5px] bg-white shadow-[0_0_0_1px_rgb(17_19_22/0.07),0_2px_8px_-2px_rgb(17_19_22/0.12)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.06)]`}
      >
        {scale !== null && (
          <iframe
            title="Template preview"
            srcDoc={withSampleValues(html)}
            sandbox=""
            loading="lazy"
            tabIndex={-1}
            aria-hidden
            className="absolute left-0 top-0 origin-top-left pointer-events-none border-0 bg-white"
            style={{ width: RENDER_WIDTH, height: `${100 / scale}%`, transform: `scale(${scale})` }}
          />
        )}
      </div>
      {/* Where the frame cuts the email off, it fades out like paper running on. */}
      <div aria-hidden className={`pointer-events-none absolute bottom-0 h-10 bg-gradient-to-t from-white/90 to-transparent ${inset === 'sm' ? 'left-2.5 right-2.5' : 'left-4 right-4'}`} />
    </div>
  )
}
