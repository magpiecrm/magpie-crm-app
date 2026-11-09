import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'

export interface MenuAction {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  /** Red, for an action that removes something. */
  danger?: boolean
  /** A rule above this item, to set it apart from the ones before. */
  separated?: boolean
}

const WIDTH = 208

/**
 * A "…" button that opens a short list of actions, as the task rows' menu
 * does: it opens below the button (above, near the bottom of the screen),
 * takes focus, moves with the arrow keys, and closes on Escape, a click
 * elsewhere or a scroll. `label` names it for screen readers.
 */
export function ActionMenu({
  label,
  actions,
  className = '',
  bordered,
}: {
  label: string
  actions: MenuAction[]
  className?: string
  /** Drawn as a small secondary button, to sit beside one. */
  bordered?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return setPlace(null)
    const r = buttonRef.current!.getBoundingClientRect()
    const h = menuRef.current?.offsetHeight ?? 220
    const top = window.innerHeight - r.bottom < h + 12 && r.top > h + 12 ? r.top - h - 4 : r.bottom + 4
    setPlace({ top, left: Math.max(8, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - 8)) })
  }, [open])

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') {
          e.stopPropagation()
          setOpen(false)
          buttonRef.current?.focus()
        }
        if (e.key === 'Tab') setOpen(false)
        return
      }
      if (e.type === 'scroll' || !(menuRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node))) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className={`relative flex shrink-0 cursor-pointer items-center justify-center rounded-md-xs transition-colors after:absolute after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-muted aria-expanded:text-foreground ${
          bordered
            ? 'h-[30px] w-[30px] border border-control bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.06)] after:-inset-[7px] max-sm:h-9 max-sm:w-9 dark:bg-white/[0.04] dark:shadow-none'
            : 'h-8 w-8 text-muted-foreground after:-inset-1.5'
        } ${className}`}
      >
        <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            style={{ position: 'fixed', top: place?.top ?? -9999, left: place?.left ?? -9999, width: WIDTH }}
            className="z-[100] rounded-md-s border border-border bg-popover p-1 shadow-lg"
          >
            {actions.map((a) => (
              <div key={a.label}>
                {a.separated && <div role="separator" className="-mx-1 my-1 border-t border-border" />}
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpen(false)
                    a.onSelect()
                  }}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md-xs px-2.5 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${a.danger ? 'text-destructive' : 'text-foreground'}`}
                >
                  {a.icon && <a.icon aria-hidden className={`h-4 w-4 ${a.danger ? '' : 'text-muted-foreground'}`} />}
                  {a.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
