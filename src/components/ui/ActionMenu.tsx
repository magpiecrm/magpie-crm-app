import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'

export type ActionMenuItem =
  | { label: string; icon?: LucideIcon; onSelect: () => void; tone?: 'danger'; disabled?: boolean }
  | 'separator'

/**
 * A "…" button and its menu of actions on one thing (a row, a card, a page).
 * Arrow keys move through it, Escape closes it and gives focus back, and it's
 * drawn over the page so a row's overflow can't clip it.
 */
export function ActionMenu({
  items,
  label,
  trigger,
  triggerClassName,
  width = 208,
}: {
  items: ActionMenuItem[]
  /** What the button does, for screen readers ("Actions for Contact page"). */
  label: string
  /** What the button shows in place of "…". */
  trigger?: ReactNode
  triggerClassName?: string
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return setPlace(null)
    const r = buttonRef.current!.getBoundingClientRect()
    const h = menuRef.current?.offsetHeight ?? 200
    const top = window.innerHeight - r.bottom < h + 12 && r.top > h + 12 ? r.top - h - 4 : r.bottom + 4
    setPlace({ top, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) })
  }, [open, width])

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus()
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape' || e.key === 'Tab') {
          if (e.key === 'Escape') e.stopPropagation()
          setOpen(false)
          buttonRef.current?.focus()
        }
        return
      }
      if (e.type === 'scroll' || !(menuRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node))) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close, true)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close, true)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const all = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])]
    const i = all.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
    all[next]?.focus()
  }

  const item =
    'flex w-full cursor-pointer items-center gap-2.5 rounded-md-xs px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className={
          triggerClassName ??
          "relative inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md-xs text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted aria-expanded:text-foreground"
        }
      >
        {trigger ?? <MoreHorizontal className="h-4 w-4" aria-hidden />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: place?.top ?? -9999, left: place?.left ?? -9999, width }}
            className="z-[100] rounded-md-s border border-border bg-popover p-1 shadow-lg"
          >
            {items.map((it, i) =>
              it === 'separator' ? (
                <div key={i} role="separator" className="-mx-1 my-1 border-t border-border" />
              ) : (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  className={`${item} ${it.tone === 'danger' ? 'text-destructive' : 'text-foreground'}`}
                  onClick={() => {
                    setOpen(false)
                    it.onSelect()
                  }}
                >
                  {it.icon && <it.icon aria-hidden className={`h-4 w-4 shrink-0 ${it.tone === 'danger' ? '' : 'text-muted-foreground'}`} />}
                  {it.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
