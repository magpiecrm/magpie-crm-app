import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import {
  exportToCsv,
  exportToXlsx,
  timestampedFilename,
  type ExportColumn,
} from '../../utils/export'

interface ExportMenuProps<T> {
  /** Base for the download name; a date and extension are appended. */
  filename: string
  rows: T[]
  columns: ExportColumn<T>[]
  sheetName?: string
  label?: string
  className?: string
}

/**
 * Download button with a column picker and a CSV / Excel choice, shared by the
 * contacts, lists and analytics tables. Both formats render the same selected
 * `columns`, so they can never drift apart.
 */
export function ExportMenu<T>({
  filename,
  rows,
  columns,
  sheetName,
  label = 'Export',
  className = '',
}: ExportMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const allHeaders = useMemo(() => columns.map(c => c.header), [columns])
  const [excluded, setExcluded] = useState<string[]>([])

  // If the caller swaps its column set, drop exclusions that no longer apply.
  useEffect(() => {
    setExcluded(prev => prev.filter(h => allHeaders.includes(h)))
  }, [allHeaders])

  const selectedColumns = useMemo(
    () => columns.filter(c => !excluded.includes(c.header)),
    [columns, excluded],
  )

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const isEmpty = rows.length === 0
  const canExport = !isEmpty && selectedColumns.length > 0

  const toggleColumn = (header: string) => {
    setExcluded(prev =>
      prev.includes(header) ? prev.filter(h => h !== header) : [...prev, header],
    )
  }

  const run = async (format: 'csv' | 'xlsx') => {
    if (!canExport) return
    setOpen(false)
    setBusy(true)
    try {
      if (format === 'csv') {
        exportToCsv(timestampedFilename(filename, 'csv'), rows, selectedColumns)
      } else {
        await exportToXlsx(
          timestampedFilename(filename, 'xlsx'),
          rows,
          selectedColumns,
          sheetName ?? filename,
        )
      }
    } catch (err: any) {
      alert(`Export failed: ${err?.message ?? err}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={isEmpty || busy}
        title={isEmpty ? 'Nothing to export' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md-s border border-border bg-transparent text-foreground hover:bg-card/80 active:bg-card shadow-sm transition-all active:scale-98 disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        ) : (
          <Download className="w-4 h-4 shrink-0" />
        )}
        <span>{label}</span>
        {!isEmpty && (
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            ({rows.length})
          </span>
        )}
        <ChevronDown
          className={`w-3.5 h-3.5 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-card border border-border rounded-md-s shadow-lg z-30 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Columns ({selectedColumns.length}/{columns.length})
            </span>
            <button
              type="button"
              onClick={() => setExcluded(excluded.length === 0 ? allHeaders : [])}
              className="text-xs font-semibold text-accent hover:underline cursor-pointer"
            >
              {excluded.length === 0 ? 'Clear all' : 'Select all'}
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {columns.map(column => {
              const checked = !excluded.includes(column.header)
              return (
                <button
                  key={column.header}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  onClick={() => toggleColumn(column.header)}
                  className="w-full flex items-center gap-2.5 text-left px-3 py-2 hover:bg-muted/50 transition-colors text-sm cursor-pointer"
                >
                  <span
                    className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
                      checked ? 'bg-accent border-accent text-accent-foreground' : 'border-border'
                    }`}
                  >
                    {checked && <Check className="w-3 h-3" strokeWidth={3} />}
                  </span>
                  <span className="truncate">{column.header}</span>
                </button>
              )
            })}
          </div>

          <div className="border-t border-border py-1">
            <button
              type="button"
              onClick={() => run('csv')}
              disabled={!canExport}
              className="w-full flex items-center gap-2.5 text-left px-3 py-2.5 hover:bg-muted/50 transition-colors text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            >
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              Download CSV
            </button>
            <button
              type="button"
              onClick={() => run('xlsx')}
              disabled={!canExport}
              className="w-full flex items-center gap-2.5 text-left px-3 py-2.5 hover:bg-muted/50 transition-colors text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            >
              <FileSpreadsheet className="w-4 h-4 text-muted-foreground shrink-0" />
              Download Excel
            </button>
            {selectedColumns.length === 0 && (
              <p className="px-3 pb-2 pt-1 text-xs text-muted-foreground">
                Pick at least one column.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
