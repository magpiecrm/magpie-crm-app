import { useLayoutEffect, useRef, useState } from 'react'
import { withSampleValues } from '../preview'

/** The width an email is laid out at before it's shrunk: over 620px, so it keeps its desktop layout rather than stacking. */
const RENDER_WIDTH = 680
/** The part of that shown: the usual 600px body, centred, so the email is as large as the frame allows. */
const SHOWN_WIDTH = 600

/**
 * A scaled-down, non-interactive picture of an email: the email laid out at
 * desktop width in a sandboxed iframe (no scripts, no navigation) and shrunk
 * so its body fills the frame's width, top first. The email's own background fills the
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
    const measure = () => setScale(frame.clientWidth / SHOWN_WIDTH)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  return (
    // A touch dimmer in dark mode, so a white email isn't the brightest thing on the page.
    <div ref={frameRef} className={`relative overflow-hidden bg-white dark:brightness-[0.92] ${className}`}>
      {scale !== null && (
        <iframe
          title="Template preview"
          srcDoc={withSampleValues(html)}
          sandbox=""
          loading="lazy"
          tabIndex={-1}
          aria-hidden
          className="absolute left-0 top-0 origin-top-left pointer-events-none border-0 bg-white"
          style={{ width: RENDER_WIDTH, height: `${100 / scale}%`, transform: `scale(${scale}) translateX(-${(RENDER_WIDTH - SHOWN_WIDTH) / 2}px)` }}
        />
      )}
    </div>
  )
}
