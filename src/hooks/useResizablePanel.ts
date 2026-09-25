import { useEffect, useRef, useState } from 'react'
import type React from 'react'

/**
 * Drag-to-resize for a panel docked to the right edge (the builders' copilot
 * aside). Dragging left widens it.
 */
export function useResizablePanel({ initial = 384, min = 280, max = 800 } = {}) {
  const [width, setWidth] = useState(initial)
  const [isResizing, setIsResizing] = useState(false)
  const start = useRef({ x: 0, width: 0 })

  const startResizing = (e: React.PointerEvent) => {
    e.preventDefault()
    start.current = { x: e.clientX, width }
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return
    const move = (e: PointerEvent) => {
      const next = start.current.width - (e.clientX - start.current.x)
      setWidth(Math.max(min, Math.min(max, next)))
    }
    const stop = () => setIsResizing(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [isResizing, min, max])

  return { width, isResizing, startResizing }
}
