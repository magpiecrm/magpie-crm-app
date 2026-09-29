import { useNavigate } from '@tanstack/react-router'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarDays, Clock, MoreHorizontal } from 'lucide-react'
import { Avatar } from '../../../components/ui/Avatar'
import { formatMoney, type DealView } from '../types'
import { daysSince, formatCloseDate, formatDays, isOverdue, nameFromEmail, STALE_DAYS } from '../utils'

/** What a deal shows on the board: name, company, value, owner, close date and time in its stage. */
function DealCardBody({ deal, onMenu }: { deal: DealView; onMenu?: () => void }) {
  const days = daysSince(deal.stage_entered_at)
  const overdue = isOverdue(deal)
  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground line-clamp-2 break-words" title={deal.name}>{deal.name}</p>
          {deal.company_name && <p className="text-xs text-muted-foreground truncate">{deal.company_name}</p>}
        </div>
        {onMenu && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onMenu()
            }}
            aria-label={`Move ${deal.name}`}
            className="-mr-1 -mt-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer shrink-0"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground tabular-nums">{formatMoney(deal.value)}</span>
        {deal.owner && (
          <span title={deal.owner}>
            <Avatar name={nameFromEmail(deal.owner)} size="sm" />
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {deal.expected_close && (
          <span
            className={`inline-flex items-center gap-1 ${overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
            title={overdue ? 'Expected close date has passed' : 'Expected close'}
          >
            <CalendarDays className="w-3 h-3" />
            {formatCloseDate(deal.expected_close)}
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 ${days > STALE_DAYS ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'}`}
          title="Time in this stage"
        >
          <Clock className="w-3 h-3" />
          {formatDays(days)}
        </span>
      </div>
    </>
  )
}

const CARD = 'block w-full text-left bg-card border border-border rounded-xl p-3 shadow-sm'

/** A deal on the board: drag it to move it, click (or Enter) to open it, or use its menu. */
export function SortableDealCard({ deal, onMenu }: { deal: DealView; onMenu: () => void }) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { type: 'deal', stageId: deal.stage_id },
  })
  const open = () => navigate({ to: '/sales/deals/$id', params: { id: deal.id } })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription="deal"
      aria-label={`${deal.name}. Press Enter to open, Space to pick up and move.`}
      onClick={open}
      onKeyDown={(e) => {
        // Keys pressed on the menu button inside are the button's own.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' && !isDragging) {
          e.preventDefault()
          open()
          return
        }
        listeners?.onKeyDown?.(e)
      }}
      className={`${CARD} cursor-grab active:cursor-grabbing hover:border-accent/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <DealCardBody deal={deal} onMenu={onMenu} />
    </div>
  )
}

/** The card that follows the pointer while dragging. */
export function DealCardOverlay({ deal }: { deal: DealView }) {
  return (
    <div className={`${CARD} cursor-grabbing shadow-lg ring-1 ring-accent/40 rotate-1`}>
      <DealCardBody deal={deal} />
    </div>
  )
}
