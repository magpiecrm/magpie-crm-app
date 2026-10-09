import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { createPipelineFn, deletePipelineFn, reorderPipelinesFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel, SettingsRow } from '../../settings/components/SettingsBlock'
import { usePipelines } from '../usePipelines'
import type { Pipeline } from '../types'
import { PipelineEditor } from './PipelineEditor'

type PipelinesData = NonNullable<ReturnType<typeof usePipelines>['data']>

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
      <div className="flex flex-col gap-4">
        <SettingsPanel>
          <SettingsBlock title="Your pipelines">
            <SettingsEmpty>Loading…</SettingsEmpty>
          </SettingsBlock>
        </SettingsPanel>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <Notice level="error">{error.message}</Notice>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {reorder.error && <Notice level="error">{reorder.error.message}</Notice>}

      <SettingsPanel>
        <SettingsBlock title="Your pipelines" description="The first pipeline is the default. Move one up or down to change the order.">
          {pipelines.length === 0 ? (
            <SettingsEmpty>No pipelines yet.</SettingsEmpty>
          ) : (
            <SettingsList>
              {pipelines.map((p, i) =>
                // A different component while editing, so a row's delete prompt doesn't outlive an edit.
                editingId === p.id ? (
                  <SettingsRow key={p.id} title={p.name} badge={i === 0 ? <Badge variant="info">Default</Badge> : undefined}>
                    <PipelineEditor pipeline={p} onDone={() => setEditingId(null)} />
                  </SettingsRow>
                ) : (
                  <PipelineRow
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
            </SettingsList>
          )}
        </SettingsBlock>

        <SettingsBlock title="Add a pipeline" description="It starts with the usual stages, which you can change.">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (newName.trim()) create.mutate()
            }}
          >
            <FieldGrid>
              <Field label="Name">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Renewals" className={INPUT_CLASS} />
              </Field>
            </FieldGrid>
            {create.error && <Notice level="error">{create.error.message}</Notice>}
            <SettingsActions>
              <Button type="submit" isLoading={create.isPending} disabled={!newName.trim()} leftIcon={<Plus className="h-4 w-4" />}>
                Add pipeline
              </Button>
            </SettingsActions>
          </form>
        </SettingsBlock>
      </SettingsPanel>
    </div>
  )
}

/** One pipeline in the list: its name, its stages, and the buttons to move, edit or delete it. */
function PipelineRow({
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
    <SettingsRow
      title={pipeline.name}
      badge={isDefault ? <Badge variant="info">Default</Badge> : undefined}
      actions={
        <>
          <Button variant="ghost" size="icon" onClick={onUp} disabled={!onUp} aria-label={`Move ${pipeline.name} up`} leftIcon={<ArrowUp className="h-4 w-4" />} />
          <Button variant="ghost" size="icon" onClick={onDown} disabled={!onDown} aria-label={`Move ${pipeline.name} down`} leftIcon={<ArrowDown className="h-4 w-4" />} />
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${pipeline.name}`} title="Edit" leftIcon={<Pencil className="h-4 w-4" />} />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirming(true)}
            disabled={!canDelete}
            title={canDelete ? 'Delete pipeline' : 'You need at least one pipeline'}
            aria-label={`Delete ${pipeline.name}`}
            className="hover:!bg-destructive/10 hover:!text-destructive"
            leftIcon={<Trash2 className="h-4 w-4" />}
          />
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ol className="flex flex-wrap gap-1.5" aria-label="Stages">
          {pipeline.stages.map((s) => (
            <li key={s.id} className="flex">
              <Badge variant={s.kind === 'won' ? 'success' : s.kind === 'lost' ? 'error' : 'default'}>
                {s.name}
                {s.kind === 'open' && <span className="tabular-nums">&nbsp;{s.probability}%</span>}
              </Badge>
            </li>
          ))}
        </ol>

        {confirming && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
            <span>Delete this pipeline?</span>
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
        {remove.error && <Notice level="error">{remove.error.message}</Notice>}
      </div>
    </SettingsRow>
  )
}
