import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'

export interface PaginationProps {
  totalItems: number
  itemsPerPage: number
  onItemsPerPageChange: (num: number) => void
  currentPage: number
  onPageChange: (page: number) => void
  itemsPerPageOptions?: number[]
}

export function Pagination({
  totalItems,
  itemsPerPage,
  onItemsPerPageChange,
  currentPage,
  onPageChange,
  itemsPerPageOptions = [10, 20, 50, 100],
}: PaginationProps) {
  const [showLimitMenu, setShowLimitMenu] = useState(false)
  const [showPageMenu, setShowPageMenu] = useState(false)

  const limitMenuRef = useRef<HTMLDivElement>(null)
  const pageMenuRef = useRef<HTMLDivElement>(null)

  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))

  // Close menus on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (limitMenuRef.current && !limitMenuRef.current.contains(event.target as Node)) {
        setShowLimitMenu(false)
      }
      if (pageMenuRef.current && !pageMenuRef.current.contains(event.target as Node)) {
        setShowPageMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const startRange = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1
  const endRange = Math.min(totalItems, currentPage * itemsPerPage)

  const pagesArray = Array.from({ length: totalPages }, (_, i) => i + 1)

  return (
    <div className="flex items-center justify-end gap-6 py-4 text-sm text-foreground/80 font-medium select-none shrink-0 border-t border-border mt-4">
      {/* Rows per page selector */}
      <div className="flex items-center gap-2 relative" ref={limitMenuRef}>
        <button
          onClick={() => setShowLimitMenu(!showLimitMenu)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-xl hover:bg-muted/40 transition-colors font-bold text-foreground text-xs bg-card cursor-pointer"
        >
          {itemsPerPage}
          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
        </button>
        <span className="text-muted-foreground text-xs font-semibold">Rows per page</span>

        {showLimitMenu && (
          <div className="absolute bottom-full left-0 mb-2 w-20 bg-card border border-border rounded-xl shadow-lg z-30 py-1 overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-150">
            {itemsPerPageOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  onItemsPerPageChange(opt)
                  setShowLimitMenu(false)
                  onPageChange(1) // Reset to first page
                }}
                className={`w-full text-center py-2 hover:bg-muted text-xs font-bold block ${
                  opt === itemsPerPage ? 'text-accent bg-accent/5' : 'text-foreground'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Range Info */}
      <div className="text-xs font-bold text-foreground">
        {startRange}-{endRange} <span className="text-muted-foreground font-semibold">of</span> {totalItems}
      </div>

      {/* Page Select Dropdown */}
      <div className="flex items-center gap-2 relative" ref={pageMenuRef}>
        <button
          onClick={() => setShowPageMenu(!showPageMenu)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-xl hover:bg-muted/40 transition-colors font-bold text-foreground text-xs bg-card cursor-pointer"
        >
          {currentPage}
          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
        </button>
        <span className="text-muted-foreground text-xs font-semibold">
          of {totalPages} {totalPages === 1 ? 'page' : 'pages'}
        </span>

        {showPageMenu && (
          <div className="absolute bottom-full left-0 mb-2 w-24 max-h-48 overflow-y-auto bg-card border border-border rounded-xl shadow-lg z-30 py-1 custom-scrollbar animate-in fade-in slide-in-from-bottom-1 duration-150">
            {pagesArray.map((page) => (
              <button
                key={page}
                onClick={() => {
                  onPageChange(page)
                  setShowPageMenu(false)
                }}
                className={`w-full text-center py-2 hover:bg-muted text-xs font-bold block ${
                  page === currentPage ? 'text-accent bg-accent/5' : 'text-foreground'
                }`}
              >
                Page {page}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Back and Next Chevrons */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="p-1.5 border border-border rounded-xl hover:bg-muted/40 transition-colors text-foreground disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          title="Previous Page"
        >
          <ChevronLeft className="w-4 h-4 text-accent" />
        </button>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="p-1.5 border border-border rounded-xl hover:bg-muted/40 transition-colors text-foreground disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          title="Next Page"
        >
          <ChevronRight className="w-4 h-4 text-accent" />
        </button>
      </div>
    </div>
  )
}
