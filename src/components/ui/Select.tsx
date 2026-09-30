import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

/**
 * A dropdown that looks like the prospect search's suggestion menus (TagInput),
 * used in place of the browser's own <select> so every dropdown in the app
 * matches. It takes the same <option> and <optgroup> children and the same
 * onChange (`e.target.value`), so swapping one in changes nothing else.
 *
 * Keyboard: arrows, Home/End, Enter or Space to choose, Escape to close, and
 * typing a letter jumps to the next option starting with it. It follows the
 * ARIA select-only combobox pattern, so screen readers announce it as one.
 */

export interface SelectChangeEvent {
  target: { value: string }
  currentTarget: { value: string }
}

interface SelectProps {
  value?: string | number
  onChange?: (e: SelectChangeEvent) => void
  children: ReactNode
  /** Styles the button, as they styled the <select>. */
  className?: string
  id?: string
  name?: string
  disabled?: boolean
  title?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

type Row =
  | { kind: 'option'; value: string; label: ReactNode; text: string; disabled: boolean; index: number }
  | { kind: 'group'; label: string }

const textOf = (node: ReactNode): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : isValidElement<{ children?: ReactNode }>(node)
        ? textOf(node.props.children)
        : ''

/** The <option>s and <optgroup>s, in order, however they're nested in fragments and arrays. */
function readRows(children: ReactNode): Row[] {
  const rows: Row[] = []
  let index = 0
  const walk = (nodes: ReactNode) => {
    Children.forEach(nodes, (node) => {
      if (!isValidElement<{ children?: ReactNode; value?: string | number; disabled?: boolean; label?: string }>(node)) return
      if (node.type === Fragment) return walk(node.props.children)
      if (node.type === 'optgroup') {
        rows.push({ kind: 'group', label: node.props.label ?? '' })
        return walk(node.props.children)
      }
      if (node.type === 'option') {
        const text = textOf(node.props.children)
        rows.push({ kind: 'option', value: String(node.props.value ?? text), label: node.props.children, text, disabled: !!node.props.disabled, index: index++ })
      }
    })
  }
  walk(children)
  return rows
}

const MENU_MAX = 240

export function Select({ value, onChange, children, className = '', id, name, disabled, title, ...aria }: SelectProps) {
  const rows = useMemo(() => readRows(children), [children])
  const options = rows.filter((r): r is Extract<Row, { kind: 'option' }> => r.kind === 'option')
  const selected = options.find((o) => o.value === String(value ?? '')) ?? options[0]
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<{ left: number; width: number; maxWidth: number; top?: number; bottom?: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const listId = useId()
  const optionId = (i: number) => `${listId}-o${i}`

  const choose = (i: number) => {
    const o = options[i]
    if (!o || o.disabled) return
    setOpen(false)
    buttonRef.current?.focus()
    if (o.value !== String(value ?? '')) onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } })
  }

  const show = () => {
    if (disabled || !options.length) return
    setActive(Math.max(0, selected ? selected.index : 0))
    setOpen(true)
  }

  // Below the button, or above it when there's more room there; fixed, so no scrolling container clips it.
  const measure = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom
    const up = below < Math.min(MENU_MAX, options.length * 32 + 8) && r.top > below
    // As wide as the button, or up to 320px for long options, but never past the screen's right edge.
    const maxWidth = Math.max(r.width, Math.min(320, window.innerWidth - r.left - 8))
    setPlace({ left: r.left, width: r.width, maxWidth, ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) })
  }, [options.length])

  useLayoutEffect(() => {
    if (open) measure()
  }, [open, measure])

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => {
      const t = e.target as Node
      if (!buttonRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    const onScroll = (e: Event) => {
      // The menu's own scrolling mustn't move it.
      if (!menuRef.current?.contains(e.target as Node)) measure()
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', measure)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const step = (from: number, by: number) => {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + by * i + options.length * i) % options.length
      if (!options[next].disabled) return next
    }
    return from
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    const key = e.key
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) {
        e.preventDefault()
        show()
      }
      return
    }
    if (key === 'ArrowDown') setActive((a) => step(a, 1))
    else if (key === 'ArrowUp') setActive((a) => step(a, -1))
    else if (key === 'Home') setActive(step(-1, 1))
    else if (key === 'End') setActive(step(options.length, -1))
    else if (key === 'Enter' || key === ' ') choose(active)
    else if (key === 'Escape') {
      // Only the menu: not a dialog it's in.
      e.stopPropagation()
      setOpen(false)
    }
    else if (key === 'Tab') return setOpen(false)
    else if (key.length === 1 && /\S/.test(key)) {
      const now = Date.now()
      typed.current = { text: now - typed.current.at < 700 ? typed.current.text + key.toLowerCase() : key.toLowerCase(), at: now }
      const match = [...options.slice(active + 1), ...options.slice(0, active + 1)].find((o) => !o.disabled && o.text.toLowerCase().startsWith(typed.current.text))
      if (match) setActive(match.index)
    } else return
    e.preventDefault()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        title={title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={`inline-flex items-center justify-between gap-2 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {name !== undefined && <input type="hidden" name={name} value={String(value ?? '')} />}
      {open &&
        place &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-label={aria['aria-label']}
            style={{ position: 'fixed', left: place.left, top: place.top, bottom: place.bottom, minWidth: place.width, maxWidth: place.maxWidth, maxHeight: MENU_MAX }}
            className="z-[100] overflow-y-auto bg-card border border-border rounded-md shadow-lg py-1"
          >
            {rows.map((r, i) =>
              r.kind === 'group' ? (
                <div key={`g${i}`} role="presentation" className="px-3 pt-2 pb-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {r.label}
                </div>
              ) : (
                <div
                  key={`o${r.index}`}
                  id={optionId(r.index)}
                  role="option"
                  aria-selected={r.value === selected?.value}
                  aria-disabled={r.disabled || undefined}
                  // Keeps focus on the button, as the combobox pattern expects.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(r.index)}
                  onMouseEnter={() => !r.disabled && setActive(r.index)}
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    r.disabled
                      ? 'text-muted-foreground/60 cursor-not-allowed'
                      : r.index === active
                        ? 'bg-accent text-accent-foreground font-semibold cursor-pointer'
                        : 'text-foreground cursor-pointer'
                  }`}
                >
                  {r.label}
                </div>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
