import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useMoreBelow } from './Dialog'
import { Button } from './Button'

/** Something to copy, with one Copy button that says when it's done. */
export function CopyBlock({ value, label, rows, mono = true, primary = false, wrap = false }: { value: string; label: string; /** Lines before it scrolls; all of it when left out. */ rows?: number; mono?: boolean; /** The dialog's main action. */ primary?: boolean; /** Wrap long lines (a link) rather than scroll sideways (code). */ wrap?: boolean }) {
  const [copied, setCopied] = useState(false)
  const pre = useRef<HTMLPreElement>(null)
  const more = useMoreBelow(pre)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = pre.current
    if (!el) return
    const measure = () => setWide(el.scrollWidth - el.scrollLeft - el.clientWidth > 4)
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [value])
  const copy = async () => {
    await navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        <Button variant={primary ? 'primary' : 'secondary'} size="sm" onClick={copy} leftIcon={copied ? <Check className={`h-3.5 w-3.5 ${primary ? '' : 'text-emerald-600 dark:text-emerald-400'}`} /> : <Copy className="h-3.5 w-3.5" />} aria-live="polite">
          {copied ? 'Copied' : primary ? 'Copy code' : 'Copy'}
        </Button>
      </div>
      <div className="relative">
        {/* Long tokens (addresses) break only where they must, so the code stays readable on a phone. */}
        <pre
          ref={pre}
          className={`custom-scrollbar overflow-auto ${wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre'} rounded-md-s border border-border bg-muted/50 px-3 py-2.5 text-[13px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${mono ? 'font-mono' : ''}`}
          style={rows ? { maxHeight: `${rows * 1.65 + 1.4}em` } : undefined}
          tabIndex={0}
          aria-label={label}
        >
          {value}
        </pre>
        {more && <div aria-hidden="true" className="pointer-events-none absolute inset-x-px bottom-px h-6 rounded-b-md-s bg-gradient-to-t from-muted to-transparent" />}
        {wide && <div aria-hidden="true" className="pointer-events-none absolute inset-y-px right-px w-10 rounded-r-md-s bg-gradient-to-l from-muted to-transparent" />}
      </div>
      {(more || wide) && <p className="text-xs text-muted-foreground">{wide ? 'Scroll sideways to see the whole lines' : 'Scroll the box to see all of it'}, or copy it whole.</p>}
    </div>
  )
}

