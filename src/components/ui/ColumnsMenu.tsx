import { useEffect, useRef, useState } from 'react'
import { Columns3 } from 'lucide-react'
import { Button } from './Button'

/** Which columns show, kept per table (by `key`) in this browser (a convenience: it can be lost, and then the defaults come back). */
export function useStoredColumns(key: string, defaults: string[]): [string[], (keys: string[]) => void] {
  const [chosen, setState] = useState<string[] | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      setState(raw ? (JSON.parse(raw) as string[]) : null)
    } catch {
      setState(null)
    }
  }, [key])
  const set = (keys: string[]) => {
    setState(keys)
    try {
      localStorage.setItem(key, JSON.stringify(keys))
    } catch {
      // Storage can be blocked; the choice lasts until the page is left.
    }
  }
  return [chosen ?? defaults, set]
}

/** A button and a list of tick boxes for the table's columns. */
export function ColumnsMenu({ options, chosen, onChange }: { options: Array<{ key: string; label: string }>; chosen: string[]; onChange: (keys: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div ref={ref} className="relative max-md:hidden">
      <Button variant="secondary" leftIcon={<Columns3 className="h-4 w-4" />} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true">
        Columns
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-60 rounded-md-s border border-border bg-popover p-1 shadow-lg" role="group" aria-label="Columns">
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">Show in the table</p>
          {options.map((o) => (
            <label key={o.key} className="flex cursor-pointer items-center gap-2.5 rounded-md-xs px-2.5 py-2 text-sm text-foreground hover:bg-muted">
              <input type="checkbox" className="h-4 w-4" checked={chosen.includes(o.key)} onChange={(e) => onChange(e.target.checked ? [...chosen, o.key] : chosen.filter((k) => k !== o.key))} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

