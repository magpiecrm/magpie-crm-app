import { useCallback, useEffect, useRef, useState } from 'react'
import type { EmailBlock } from '../types'

/**
 * What is being dragged: an existing block, or a new one from the palette.
 * Generic over the block type so the survey builder can share this hook;
 * `pageId` is only used by builders whose canvas is split into pages.
 */
export type DragPayload<T extends string = EmailBlock['type']> =
  | { kind: 'move'; index: number; pageId?: string }
  | { kind: 'new'; blockType: T }

export type DropAlign = 'left' | 'center' | 'right'

export interface BlockDropTarget {
  /** Index to insert at. Equals `blocks.length` when dropped past the last block. */
  index: number
  align: DropAlign
  /** The `data-page-id` of the page body under the pointer, for paged canvases. */
  pageId?: string
}

/** Touch drags wait this long before engaging, so a swipe still scrolls the canvas. */
const LONG_PRESS_MS = 250
/** Mouse drags engage once the pointer travels this far — below it, the gesture is a click. */
const DRAG_START_PX = 4
/** A touch that travels further than this before the timer fires is a scroll, not a drag. */
const MOVE_CANCEL_PX = 10
/** Distance from a canvas edge at which the canvas starts auto-scrolling. */
const EDGE_SCROLL_PX = 60
const EDGE_SCROLL_SPEED = 12

function alignFromX(clientX: number, rect: DOMRect): DropAlign {
  const x = clientX - rect.left
  if (x < rect.width * 0.33) return 'left'
  if (x > rect.width * 0.66) return 'right'
  return 'center'
}

function pageIdOf(el: HTMLElement): string | undefined {
  return (el.closest('[data-page-id]') as HTMLElement | null)?.dataset.pageId
}

/**
 * Locate the drop target under the pointer.
 *
 * Blocks tag themselves with `data-block-index`; the canvas body tags itself
 * with `data-canvas-body`. Dropping in the lower half of a block inserts after
 * it, which is what makes dragging to the very bottom of the list work.
 */
function resolveTarget(clientX: number, clientY: number): BlockDropTarget | null {
  const el = document.elementFromPoint(clientX, clientY)
  if (!el) return null

  const blockEl = el.closest('[data-block-index]') as HTMLElement | null
  if (blockEl) {
    const rect = blockEl.getBoundingClientRect()
    const index = Number(blockEl.dataset.blockIndex)
    const after = clientY > rect.top + rect.height / 2
    return { index: after ? index + 1 : index, align: alignFromX(clientX, rect), pageId: pageIdOf(blockEl) }
  }

  const canvasBody = el.closest('[data-canvas-body]') as HTMLElement | null
  if (canvasBody) {
    const rect = canvasBody.getBoundingClientRect()
    return { index: Number(canvasBody.dataset.blockCount ?? 0), align: alignFromX(clientX, rect), pageId: pageIdOf(canvasBody) }
  }

  return null
}

function autoScroll(clientY: number) {
  const scroller = document.querySelector('[data-canvas-scroll]') as HTMLElement | null
  if (!scroller) return
  const rect = scroller.getBoundingClientRect()
  if (clientY < rect.top + EDGE_SCROLL_PX) {
    scroller.scrollTop -= EDGE_SCROLL_SPEED
  } else if (clientY > rect.bottom - EDGE_SCROLL_PX) {
    scroller.scrollTop += EDGE_SCROLL_SPEED
  }
}

/**
 * Pointer-event drag controller for the email canvas.
 *
 * Replaces HTML5 drag-and-drop, which never fires on touch devices. One code
 * path serves mouse, touch and pen. The move-up/move-down buttons remain the
 * gesture-free fallback.
 *
 * A drag only engages once the pointer has actually travelled (mouse) or been
 * held (touch), so a plain tap still reaches the element's `onClick`. Nothing
 * calls `preventDefault()` on pointerdown, which would suppress that click.
 */
export function useBlockDrag<T extends string = EmailBlock['type']>(
  onDrop: (payload: DragPayload<T>, target: BlockDropTarget) => void,
) {
  const [dragging, setDragging] = useState<DragPayload<T> | null>(null)
  const [dropTarget, setDropTarget] = useState<BlockDropTarget | null>(null)

  const pending = useRef<{
    payload: DragPayload<T>
    startX: number
    startY: number
    pointerType: string
    timer: ReturnType<typeof setTimeout> | null
  } | null>(null)
  /** True once a gesture became a real drag — guard `onClick` handlers with it. */
  const didDrag = useRef(false)
  const draggingRef = useRef<DragPayload<T> | null>(null)
  const dropTargetRef = useRef<BlockDropTarget | null>(null)

  const engage = useCallback((payload: DragPayload<T>) => {
    draggingRef.current = payload
    didDrag.current = true
    // Stop the browser turning the drag into a text selection.
    document.body.style.userSelect = 'none'
    setDragging(payload)
  }, [])

  const reset = useCallback(() => {
    if (pending.current?.timer) clearTimeout(pending.current.timer)
    pending.current = null
    draggingRef.current = null
    dropTargetRef.current = null
    document.body.style.userSelect = ''
    setDragging(null)
    setDropTarget(null)
  }, [])

  const startDrag = useCallback(
    (e: React.PointerEvent, payload: DragPayload<T>) => {
      e.stopPropagation()
      // Deliberately no preventDefault: it would cancel the click that a tap needs.
      didDrag.current = false

      if (e.pointerType === 'mouse') {
        pending.current = { payload, startX: e.clientX, startY: e.clientY, pointerType: 'mouse', timer: null }
        return
      }

      // Touch/pen: hold before the drag takes over, so a swipe still scrolls.
      const timer = setTimeout(() => engage(payload), LONG_PRESS_MS)
      pending.current = { payload, startX: e.clientX, startY: e.clientY, pointerType: e.pointerType, timer }
    },
    [engage],
  )

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const p = pending.current
      if (!p) return

      if (!draggingRef.current) {
        const dx = Math.abs(e.clientX - p.startX)
        const dy = Math.abs(e.clientY - p.startY)
        if (p.pointerType === 'mouse') {
          // Past the threshold this is a drag, not a click.
          if (dx <= DRAG_START_PX && dy <= DRAG_START_PX) return
          engage(p.payload)
          // Fall through, so the move that engages also picks a drop target —
          // otherwise a quick drag-and-release would commit nothing.
        } else {
          // Still waiting on the long press — a real move means the user is scrolling.
          if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) reset()
          return
        }
      }

      if (e.cancelable) e.preventDefault()
      autoScroll(e.clientY)
      const target = resolveTarget(e.clientX, e.clientY)
      dropTargetRef.current = target
      setDropTarget(target)
    }

    const handleUp = () => {
      const payload = draggingRef.current
      const target = dropTargetRef.current
      if (payload && target) onDrop(payload, target)
      reset()
    }

    window.addEventListener('pointermove', handleMove, { passive: false })
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', reset)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', reset)
    }
  }, [onDrop, reset, engage])

  return {
    /** Attach to a drag handle's `onPointerDown`. */
    startDrag,
    /** The in-flight drag, or null. */
    dragging,
    /** Where the drop would land right now, for the insertion indicator. */
    dropTarget,
    /** True if the last gesture became a drag — guard `onClick` with it. */
    didDrag,
  }
}
