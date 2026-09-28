import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Check, Trophy, X, XCircle } from 'lucide-react'
import { moveDealFn } from '../../../server/functions'
import { Sheet } from '../../../components/ui/Sheet'
import { formatMoney, type DealView, type Pipeline, type PipelineStage } from '../types'
import { applyMove, closedStage, indexAmongAll, inStage, openStages, sumValue } from '../utils'
import { DealCardOverlay, SortableDealCard } from './DealCard'
import { LostReasonDialog } from './LostReasonDialog'
import { useRefreshSales } from './useSalesLookups'

/** Mouse and pen drag straight away; touch is left to TouchSensor's long press, so a swipe still scrolls. */
class MouseAndPenSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent }: ReactPointerEvent) => nativeEvent.isPrimary && nativeEvent.button === 0 && nativeEvent.pointerType !== 'touch',
    },
  ]
}

// Droppable ids: a column is `col:<stageId>`, the Won/Lost zones `zone:<stageId>`; cards are deal ids.
const COL = 'col:'
const ZONE = 'zone:'
const isCol = (id: UniqueIdentifier) => String(id).startsWith(COL)
const isZone = (id: UniqueIdentifier) => String(id).startsWith(ZONE)
const stageOf = (id: UniqueIdentifier) => String(id).slice(String(id).indexOf(':') + 1)

type Columns = Record<string, string[]>

/**
 * The board for one pipeline: a column per open stage, and Won and Lost drop
 * zones after them. `deals` is the pipeline's whole cached list (under
 * `queryKey`), and `isShown` the page's owner and search filters. Moves update
 * that cache straight away and roll back if the server refuses.
 */
export function PipelineBoard({
  pipeline,
  deals,
  isShown,
  queryKey,
}: {
  pipeline: Pipeline
  deals: DealView[]
  isShown: (deal: DealView) => boolean
  queryKey: QueryKey
}) {
  const queryClient = useQueryClient()
  const refresh = useRefreshSales()
  const stages = useMemo(() => openStages(pipeline), [pipeline])
  const won = closedStage(pipeline, 'won')
  const lost = closedStage(pipeline, 'lost')
  const stageById = useMemo(() => new Map(pipeline.stages.map((s) => [s.id, s])), [pipeline])
  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals])
  const shown = useMemo(() => deals.filter(isShown), [deals, isShown])

  // The columns as the cache has them; while dragging, a working copy the drag rearranges.
  const base = useMemo<Columns>(() => Object.fromEntries(stages.map((s) => [s.id, inStage(shown, s.id).map((d) => d.id)])), [stages, shown])
  const [dragging, setDragging] = useState<Columns | null>(null)
  const columns = dragging ?? base
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<DealView | null>(null)
  const [lostFor, setLostFor] = useState<DealView | null>(null)

  const sensors = useSensors(
    useSensor(MouseAndPenSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter opens a card, so only Space picks one up.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  )

  // Right after a card changes column the layout shifts under the pointer;
  // holding the last target for a frame stops it flicking back and forth.
  const lastOver = useRef<UniqueIdentifier | null>(null)
  const justMoved = useRef(false)
  const collisionDetection: CollisionDetection = (args) => {
    if (justMoved.current && lastOver.current) return [{ id: lastOver.current }]
    const within = pointerWithin(args)
    const zone = within.find((c) => isZone(c.id))
    const hits = zone ? [zone] : within.length ? within : closestCorners(args)
    lastOver.current = hits[0]?.id ?? null
    return hits
  }

  const columnOf = (id: UniqueIdentifier, cols: Columns): string | null => {
    if (isCol(id)) return stageOf(id)
    if (isZone(id)) return null
    return Object.keys(cols).find((stageId) => cols[stageId]!.includes(String(id))) ?? null
  }

  /** Moves a deal in the cache, then on the server; puts it back if the server says no. */
  async function commit(dealId: string, stage: PipelineStage, index: number, lostReason?: string | null) {
    setError(null)
    await queryClient.cancelQueries({ queryKey })
    const before = queryClient.getQueryData<DealView[]>(queryKey)
    if (before) queryClient.setQueryData(queryKey, applyMove(before, dealId, pipeline, stage, index, lostReason))
    setDragging(null)
    try {
      await moveDealFn({ data: { id: dealId, stageId: stage.id, index, ...(lostReason !== undefined ? { lostReason } : {}) } })
    } catch (e) {
      if (before) queryClient.setQueryData(queryKey, before)
      setError(`Couldn't move ${dealById.get(dealId)?.name ?? 'the deal'}: ${(e as Error).message}`)
    } finally {
      refresh(dealId)
    }
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    setError(null)
    setActiveId(String(active.id))
    setDragging(base)
  }

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || isZone(over.id)) return
    const below = !!active.rect.current.translated && active.rect.current.translated.top > over.rect.top + over.rect.height / 2
    setDragging((cols) => {
      if (!cols) return cols
      const from = columnOf(active.id, cols)
      const to = columnOf(over.id, cols)
      if (!from || !to || from === to) return cols
      const target = cols[to]!
      const overIndex = isCol(over.id) ? -1 : target.indexOf(String(over.id))
      const index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length
      justMoved.current = true
      requestAnimationFrame(() => (justMoved.current = false))
      return {
        ...cols,
        [from]: cols[from]!.filter((id) => id !== active.id),
        [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
      }
    })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    const deal = dealById.get(String(active.id))
    if (!over || !dragging || !deal) return setDragging(null)

    if (isZone(over.id)) {
      const stage = stageById.get(stageOf(over.id))
      setDragging(null)
      if (!stage) return
      if (stage.kind === 'lost') setLostFor(deal)
      else void commit(deal.id, stage, 0)
      return
    }

    const to = columnOf(over.id, dragging)
    if (!to) return setDragging(null)
    let order = dragging[to]!
    const from = order.indexOf(deal.id)
    const onto = isCol(over.id) ? order.length - 1 : order.indexOf(String(over.id))
    if (from >= 0 && onto >= 0 && from !== onto) order = arrayMove(order, from, onto)

    const stage = stageById.get(to)
    const unchanged = to === deal.stage_id && order.join() === base[to]!.join()
    if (!stage || unchanged) return setDragging(null)
    void commit(deal.id, stage, indexAmongAll(deal.id, order, inStage(deals, to).map((d) => d.id)))
  }

  const where = (id: UniqueIdentifier | undefined) => {
    if (id === undefined) return 'nowhere'
    const stageId = isCol(id) || isZone(id) ? stageOf(id) : dealById.get(String(id))?.stage_id
    return stageById.get(stageId ?? '')?.name ?? 'this column'
  }
  const nameOf = (id: UniqueIdentifier) => dealById.get(String(id))?.name ?? 'The deal'
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is over ${where(over.id)}.` : `${nameOf(active.id)} is not over a stage.`),
    onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} dropped in ${where(over.id)}.` : `${nameOf(active.id)} put back.`),
    onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} cancelled.`,
  }

  const active = activeId ? dealById.get(activeId) : undefined
  const closedDeals = (stage?: PipelineStage) => (stage ? shown.filter((d) => d.stage_id === stage.id) : [])

  /** "Move to" from a card's menu: to the top of the stage, asking for a reason for Lost. */
  const moveTo = (deal: DealView, stage: PipelineStage) => {
    setMenuFor(null)
    if (stage.id === deal.stage_id) return
    if (stage.kind === 'lost') setLostFor(deal)
    else void commit(deal.id, stage, 0)
  }

  return (
    <>
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 px-4 py-3 rounded-xl border border-destructive/30 bg-destructive/10 text-sm text-destructive">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="p-0.5 rounded hover:bg-destructive/10 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null)
          setDragging(null)
        }}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: 'Press Enter to open this deal. To move it, press Space, use the arrow keys, then press Space again to drop it, or Escape to cancel.',
          },
        }}
      >
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 lg:mx-0 lg:px-0 snap-x snap-mandatory lg:snap-none custom-scrollbar">
          {stages.map((stage) => {
            const cards = columns[stage.id]!.map((id) => dealById.get(id)).filter((d): d is DealView => !!d)
            return <StageColumn key={stage.id} stage={stage} deals={cards} onMenu={setMenuFor} />
          })}
          <div className="w-40 shrink-0 flex flex-col gap-3 snap-start">
            {won && <ClosedZone stage={won} deals={closedDeals(won)} pipelineId={pipeline.id} />}
            {lost && <ClosedZone stage={lost} deals={closedDeals(lost)} pipelineId={pipeline.id} />}
          </div>
        </div>
        <DragOverlay>{active ? <DealCardOverlay deal={active} /> : null}</DragOverlay>
      </DndContext>

      <Sheet isOpen={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor ? `Move ${menuFor.name}` : 'Move to'}>
        {menuFor && (
          <ul className="py-2">
            {pipeline.stages.map((stage) => {
              const current = stage.id === menuFor.stage_id
              return (
                <li key={stage.id}>
                  <button
                    type="button"
                    onClick={() => moveTo(menuFor, stage)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted cursor-pointer"
                  >
                    {stage.kind === 'won' ? (
                      <Trophy className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    ) : stage.kind === 'lost' ? (
                      <XCircle className="w-4 h-4 text-destructive" />
                    ) : (
                      <span className="w-4 h-4 flex items-center justify-center">
                        <span className="w-2 h-2 rounded-full bg-muted-foreground/50" />
                      </span>
                    )}
                    <span className={`flex-1 ${current ? 'font-semibold text-foreground' : 'text-foreground'}`}>{stage.name}</span>
                    {current && <Check className="w-4 h-4 text-accent" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Sheet>

      <LostReasonDialog
        isOpen={!!lostFor}
        dealName={lostFor?.name}
        onCancel={() => setLostFor(null)}
        onConfirm={(reason) => {
          const deal = lostFor
          setLostFor(null)
          if (deal && lost) void commit(deal.id, lost, 0, reason)
        }}
      />
    </>
  )
}

function StageColumn({ stage, deals, onMenu }: { stage: PipelineStage; deals: DealView[]; onMenu: (deal: DealView) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COL}${stage.id}`, data: { type: 'column', stageId: stage.id } })
  return (
    <section
      aria-label={stage.name}
      className={`w-[17rem] shrink-0 snap-start flex flex-col rounded-xl border bg-muted/40 transition-colors ${isOver ? 'border-accent/50' : 'border-border'}`}
    >
      <header className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground truncate flex-1">{stage.name}</h2>
          <span className="text-xs font-medium text-muted-foreground bg-background border border-border rounded-full px-2 py-0.5 tabular-nums">{deals.length}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-foreground tabular-nums">{formatMoney(sumValue(deals))}</span>
          <span className="text-muted-foreground" title="Chance a deal here is won">
            {stage.probability}%
          </span>
        </div>
      </header>
      <SortableContext id={stage.id} items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex-1 min-h-24 px-2 pb-2 space-y-2">
          {deals.map((deal) => (
            <SortableDealCard key={deal.id} deal={deal} onMenu={() => onMenu(deal)} />
          ))}
          {deals.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-lg">Drop a deal here</p>
          )}
        </div>
      </SortableContext>
    </section>
  )
}

function ClosedZone({ stage, deals, pipelineId }: { stage: PipelineStage; deals: DealView[]; pipelineId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${ZONE}${stage.id}`, data: { type: 'zone', stageId: stage.id } })
  const isWon = stage.kind === 'won'
  const Icon = isWon ? Trophy : XCircle
  const tone = isWon
    ? isOver
      ? 'border-emerald-500 bg-emerald-500/15'
      : 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10'
    : isOver
      ? 'border-destructive bg-destructive/15'
      : 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
  return (
    <Link
      ref={setNodeRef}
      to="/sales/deals"
      search={{ status: stage.kind === 'won' ? 'won' : 'lost', pipeline: pipelineId }}
      className={`flex-1 min-h-28 flex flex-col justify-center gap-1 rounded-xl border-2 border-dashed p-3 transition-colors ${tone}`}
    >
      <span className={`flex items-center gap-1.5 text-sm font-semibold ${isWon ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>
        <Icon className="w-4 h-4 shrink-0" />
        <span className="truncate">{stage.name}</span>
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {deals.length} {deals.length === 1 ? 'deal' : 'deals'}
      </span>
      <span className="text-sm font-medium text-foreground tabular-nums">{formatMoney(sumValue(deals))}</span>
    </Link>
  )
}
