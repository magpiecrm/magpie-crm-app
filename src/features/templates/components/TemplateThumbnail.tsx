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
 * every screen: the email's body (`.em-container`) on a neutral backing,
 * fitted to its width and pinned the same distance from the top, so the
 * emails along a row start level. A long one runs off the bottom, fading out
 * there in light mode (in dark, a fade to the dark backing would smear the
 * email grey, so it's cut clean).
 *
 * The email is laid out in a sandboxed iframe at desktop width. It may be
 * read (to measure its body) but runs no scripts and can't navigate.
 *
 * The frame's shape comes from `className` (e.g. `aspect-[4/5]`).
 */
export function TemplateThumbnail({ html, className = '', inset = 12 }: { html: string; className?: string; inset?: number }) {
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
  const cut = frame ? b.h * scale > frame.h - inset : false
  const top = inset

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
      {box && cut && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-muted to-transparent dark:hidden" />
      )}
    </div>
  )
}
