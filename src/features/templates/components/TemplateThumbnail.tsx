import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { withSampleValues } from '../preview'

/** The width an email is laid out at: over 620px, so it keeps its desktop layout rather than stacking. */
const RENDER_WIDTH = 680

/**
 * Takes the email's own background off, so every thumbnail sits on the same
 * backing whatever colour the email puts around its body.
 */
const CLEAR_CANVAS = '<style>html,body,body>table{background:transparent!important;background-image:none!important}</style>'

interface Box {
  x: number
  y: number
  w: number
  h: number
  doc: number
}

/**
 * A scaled-down, non-interactive picture of an email, framed the same way on
 * every screen: the email's body (`.em-container`) inset on a neutral backing
 * and fitted to its width. A short email shows whole, centred; a long one
 * runs off the bottom edge. `top` always fills the width from the top, for a
 * wide, short frame that shows an email's opening.
 *
 * The email is laid out in a sandboxed iframe at desktop width. It may be
 * read (to measure its body) but runs no scripts and can't navigate.
 *
 * The frame's shape comes from `className` (e.g. `aspect-[4/5]`).
 */
export function TemplateThumbnail({
  html,
  className = '',
  inset = 12,
  top: fromTop = false,
}: {
  html: string
  className?: string
  inset?: number
  top?: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const doc = useMemo(() => {
    const filled = withSampleValues(html)
    return filled.includes('</head>') ? filled.replace('</head>', `${CLEAR_CANVAS}</head>`) : CLEAR_CANVAS + filled
  }, [html])

  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const onLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const d = e.currentTarget.contentDocument
    if (!d) return
    const body = d.querySelector('.em-container') ?? d.body
    const r = body.getBoundingClientRect()
    setBox({ x: r.left, y: r.top, w: r.width || RENDER_WIDTH, h: r.height || 1, doc: d.documentElement.scrollHeight })
  }

  // Until the email has loaded, assume the usual 600px body 24px down.
  const b = box ?? { x: (RENDER_WIDTH - 600) / 2, y: 24, w: 600, h: 2000, doc: 2000 }
  const scale = frame ? (frame.w - inset * 2) / b.w : 0
  const shown = b.h * scale
  const fits = frame && !fromTop ? shown <= frame.h - inset * 2 : false
  const top = frame ? (fits ? (frame.h - shown) / 2 : inset) : 0

  return (
    <div
      ref={frameRef}
      className={`relative overflow-hidden bg-muted dark:bg-[#1f2226] ${className}`}
    >
      {frame && (
        <iframe
          title="Template preview"
          srcDoc={doc}
          sandbox="allow-same-origin"
          loading="lazy"
          tabIndex={-1}
          aria-hidden
          onLoad={onLoad}
          className={`absolute left-0 top-0 origin-top-left pointer-events-none border-0 bg-transparent transition-opacity duration-150 dark:brightness-[0.96] ${box ? 'opacity-100' : 'opacity-0'}`}
          style={{
            // Emails have no dark mode. Matching the email's own (light) scheme keeps the frame
            // see-through on a dark page: a browser paints a mismatched frame opaque.
            colorScheme: 'light',
            width: RENDER_WIDTH,
            height: b.doc,
            transform: `translate(${inset - b.x * scale}px, ${top - b.y * scale}px) scale(${scale})`,
          }}
        />
      )}
    </div>
  )
}
