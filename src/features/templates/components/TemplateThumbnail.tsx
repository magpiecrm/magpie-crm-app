const RENDER_WIDTH = 640

/**
 * A scaled-down, non-interactive render of an email. The HTML is laid out at
 * desktop width inside a sandboxed iframe (no scripts, no navigation) and
 * shrunk with a CSS transform to fill the card.
 */
export function TemplateThumbnail({ html, height = 220, scale = 0.4 }: { html: string; height?: number; scale?: number }) {
  return (
    <div className="relative overflow-hidden bg-muted/30 border-b border-border" style={{ height }}>
      <iframe
        title="Template preview"
        srcDoc={html}
        sandbox=""
        tabIndex={-1}
        aria-hidden
        className="absolute top-0 left-1/2 origin-top pointer-events-none border-0 bg-white"
        style={{
          width: RENDER_WIDTH,
          height: height / scale,
          transform: `translateX(-50%) scale(${scale})`,
        }}
      />
    </div>
  )
}
