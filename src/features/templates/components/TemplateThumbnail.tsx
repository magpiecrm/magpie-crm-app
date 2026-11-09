import { useLayoutEffect, useRef, useState } from 'react'
import { withSampleValues } from '../preview'

/** The width an email is laid out at before it's shrunk: a little over the usual 600px body, so its own background shows at the sides. */
const RENDER_WIDTH = 680

/**
 * A scaled-down, non-interactive picture of an email: the email laid out at
 * desktop width in a sandboxed iframe (no scripts, no navigation) and shrunk
 * to the frame's width, top first. The email's own background fills the
 * frame, as it would an inbox, so there's one edge (the frame's) and no
 * box-in-a-box.
 *
 * The frame's shape comes from `className` (e.g. `aspect-[4/3]`).
 */
export function TemplateThumbnail({ html, className = '' }: { html: string; className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState<number | null>(null)

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const measure = () => setScale(frame.clientWidth / RENDER_WIDTH)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={frameRef} className={`relative overflow-hidden bg-white ${className}`}>
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
  )
}
