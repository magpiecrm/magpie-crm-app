import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { createPipelineFn, deletePipelineFn, reorderPipelinesFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { FIELD_CLASS } from '../forms'
import { usePipelines } from '../usePipelines'
import type { Pipeline } from '../types'
import { PipelineEditor } from './PipelineEditor'

type PipelinesData = NonNullable<ReturnType<typeof usePipelines>['data']>

const ICON_BUTTON =
  'p-1.5 rounded-md-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-30 disabled:pointer-events-none'

/**
 * Settings → Pipelines: the pipelines in order (the first is the default),
 * each with its stages. Pipelines can be added, renamed, reordered, have
 * their stages edited, and be deleted once they have no deals.
 */
export function PipelineSettings() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = usePipelines()
  const pipelines = data?.pipelines ?? []
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const create = useMutation({
    mutationFn: () => createPipelineFn({ data: { name: newName.trim(), stages: [] } }),
    onSuccess: (pipeline) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sales.pipelines() })
      setNewName('')
      setEditingId(pipeline.id)
    },
  })

  // Reordering shows at once and goes back if the server says no.
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderPipelinesFn({ data: { ids } }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.sales.pipelines() })
      const before = queryClient.getQueryData<PipelinesData>(queryKeys.sales.pipelines())
      if (before) {
        const byId = new Map(before.pipelines.map((p) => [p.id, p]))
        queryClient.setQueryData<PipelinesData>(queryKeys.sales.pipelines(), {
          ...before,
          pipelines: ids.flatMap((id, position) => {
            const p = byId.get(id)
            return p ? [{ ...p, position }] : []
          }),
        })
      }
      return { before }
    },
    onError: (_err, _ids, context) => {
      if (context?.before) queryClient.setQueryData(queryKeys.sales.pipelines(), context.before)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.sales.pipelines() }),
  })

  const move = (index: number, by: -1 | 1) => {
    const ids = pipelines.map((p) => p.id)
    ;[ids[index], ids[index + by]] = [ids[index + by], ids[index]]
    reorder.mutate(ids)
  }

  if (isLoading) {
    return (
      <div className="space-y-3 max-w-3xl">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-28 bg-muted animate-pulse rounded-xl" />
        ))}
      </div>
    )
  }

  if (error) return <p className="text-sm text-destructive">{error.message}</p>

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-3">
        {reorder.error && <p className="text-sm text-destructive">{reorder.error.message}</p>}
        {pipelines.map((p, i) =>
          editingId === p.id ? (
            <PipelineEditor key={p.id} pipeline={p} onDone={() => setEditingId(null)} />
          ) : (
            <PipelineCard
              key={p.id}
              pipeline={p}
              isDefault={i === 0}
              canDelete={pipelines.length > 1}
              onUp={i > 0 ? () => move(i, -1) : undefined}
              onDown={i < pipelines.length - 1 ? () => move(i, 1) : undefined}
              onEdit={() => setEditingId(p.id)}
            />
          ),
        )}
      </div>

      <form
        className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (newName.trim()) create.mutate()
        }}
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground">New pipeline</h3>
          <p className="text-sm text-muted-foreground">It starts with the usual stages, which you can change.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            aria-label="Pipeline name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Renewals"
            className={FIELD_CLASS}
          />
          <Button type="submit" isLoading={create.isPending} disabled={!newName.trim()} leftIcon={<Plus className="w-4 h-4" />} className="shrink-0">
            Add pipeline
          </Button>
        </div>
        {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}
      </form>
    </div>
  )
}

function PipelineCard({
  pipeline,
  isDefault,
  canDelete,
  onUp,
  onDown,
  onEdit,
}: {
  pipeline: Pipeline
  isDefault: boolean
  canDelete: boolean
  onUp?: () => void
  onDown?: () => void
  onEdit: () => void
}) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({
    mutationFn: () => deletePipelineFn({ data: { id: pipeline.id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sales.pipelines() }),
  })

  return (
    <div className="bg-card border border-border rounded-xl p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex flex-col shrink-0 -my-1">
          <button type="button" onClick={onUp} disabled={!onUp} aria-label={`Move ${pipeline.name} up`} className={ICON_BUTTON}>
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onDown} disabled={!onDown} aria-label={`Move ${pipeline.name} down`} className={ICON_BUTTON}>
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-foreground truncate">{pipeline.name}</h3>
            {isDefault && <Badge variant="info">Default</Badge>}
          </div>
          <ol className="flex flex-wrap gap-1.5 mt-2" aria-label="Stages">
            {pipeline.stages.map((s) => (
              <li
                key={s.id}
                className={`px-2 py-0.5 rounded-md-xs text-xs ${
                  s.kind === 'won'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : s.kind === 'lost'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-muted text-foreground'
                }`}
              >
                {s.name}
                {s.kind === 'open' && <span className="text-muted-foreground tabular-nums"> {s.probability}%</span>}
              </li>
            ))}
          </ol>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" onClick={onEdit} leftIcon={<Pencil className="w-3.5 h-3.5" />}>
            Edit
          </Button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!canDelete}
            title={canDelete ? 'Delete pipeline' : 'You need at least one pipeline'}
            aria-label={`Delete ${pipeline.name}`}
            className="p-1.5 rounded-md-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {confirming && (
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border text-sm">
          <span className="text-foreground">Delete this pipeline?</span>
          <Button variant="danger" size="sm" isLoading={remove.isPending} onClick={() => remove.mutate()}>
            Delete
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirming(false)
              remove.reset()
            }}
          >
            Cancel
          </Button>
        </div>
      )}
      {remove.error && <p className="text-xs text-destructive">{remove.error.message}</p>}
    </div>
  )
}
