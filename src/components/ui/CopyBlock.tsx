import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useMoreBelow } from './Dialog'
import { Button } from './Button'

/** Something to copy, with one Copy button that says when it's done. */
export function CopyBlock({ value, label, rows, mono = true, primary = false, wrap = false, copyLabel, inline = false }: { value: string; label: string; /** A one-line value (a link) with its button at the end of the field rather than above it. */ inline?: boolean; /** The button's words before it's pressed; "Copy code" for the main one, "Copy" otherwise. */ copyLabel?: string; /** Lines before it scrolls; all of it when left out. */ rows?: number; mono?: boolean; /** The dialog's main action. */ primary?: boolean; /** Wrap long lines (a link) rather than scroll sideways (code). */ wrap?: boolean }) {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')
  const pre = useRef<HTMLPreElement>(null)
  const field = useRef<HTMLParagraphElement>(null)
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(reset.current), [])
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
  // "Copied" only once the browser has taken it. When it refuses (no permission, or a copy served over plain
  // http, which has no clipboard), the text is selected instead, so copying it by hand is one shortcut away.
  const copy = async () => {
    clearTimeout(reset.current)
    try {
      if (!navigator.clipboard) throw new Error('No clipboard here')
      await navigator.clipboard.writeText(value)
      setCopied('yes')
      reset.current = setTimeout(() => setCopied('no'), 1800)
    } catch {
      const el = inline ? field.current : pre.current
      const selection = window.getSelection()
      if (el && selection) {
        const range = document.createRange()
        range.selectNodeContents(el)
        selection.removeAllRanges()
        selection.addRange(range)
      }
      setCopied('failed')
      reset.current = setTimeout(() => setCopied('no'), 6000)
    }
  }
  const button = (
    <Button variant={primary ? 'primary' : 'secondary'} size={inline ? 'md' : 'sm'} onClick={copy} leftIcon={copied === 'yes' ? <Check className={`h-3.5 w-3.5 ${primary ? '' : 'text-emerald-600 dark:text-emerald-400'}`} /> : <Copy className="h-3.5 w-3.5" />} aria-live="polite" className={inline ? 'shrink-0' : ''}>
      {copied === 'yes' ? 'Copied' : copyLabel ?? (primary ? 'Copy code' : 'Copy')}
    </Button>
  )
  const failed = copied === 'failed' && (
    <p className="text-xs text-destructive" role="status">
      Your browser didn't let it be copied. It's selected: press Ctrl+C (⌘C on a Mac) to copy it.
    </p>
  )
  if (inline) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        <div className="flex items-stretch gap-2">
          <p ref={field} className="flex min-w-0 flex-1 items-center rounded-md-s border border-border bg-muted/50 px-3 py-2 text-sm text-foreground [overflow-wrap:anywhere]" aria-label={label}>
            {value}
          </p>
          {button}
        </div>
        {failed}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        {button}
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
      {failed || ((more || wide) && <p className="text-xs text-muted-foreground">{wide ? 'Scroll sideways to see the whole lines' : 'Scroll the box to see all of it'}, or copy it whole.</p>)}
    </div>
  )
}

