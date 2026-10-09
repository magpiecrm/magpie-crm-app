import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { updatePipelineFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { useInvalidateSales } from '../usePipelines'
import type { Pipeline, PipelineStage } from '../types'

/** A stage being edited. New stages have no id; `key` keeps React rows stable. */
interface DraftStage {
  key: string
  id?: string
  name: string
  probability: string
}

const toDraft = (s: PipelineStage): DraftStage => ({ key: s.id, id: s.id, name: s.name, probability: String(s.probability) })

const percent = (raw: string) => {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0
}

/**
 * Renames a pipeline and edits its stages: open stages with a name and a
 * chance of winning, in order, then the Won and Lost stages, which can be
 * renamed but always come last. Shown inside the pipeline's row in Settings,
 * so it has no card of its own.
 */
export function PipelineEditor({ pipeline, onDone }: { pipeline: Pipeline; onDone: () => void }) {
  const invalidateSales = useInvalidateSales()
  const [name, setName] = useState(pipeline.name)
  const [open, setOpen] = useState(() => pipeline.stages.filter((s) => s.kind === 'open').map(toDraft))
  const [won, setWon] = useState(() => pipeline.stages.find((s) => s.kind === 'won')?.name ?? 'Won')
  const [lost, setLost] = useState(() => pipeline.stages.find((s) => s.kind === 'lost')?.name ?? 'Lost')
  const nextKey = useRef(0)

  const save = useMutation({
    mutationFn: () =>
      updatePipelineFn({
        data: {
          id: pipeline.id,
          name: name.trim(),
          stages: [
            ...open.map((s) => ({ id: s.id, name: s.name.trim(), probability: percent(s.probability), kind: 'open' as const })),
            { id: pipeline.stages.find((s) => s.kind === 'won')?.id, name: won.trim(), probability: 100, kind: 'won' as const },
            { id: pipeline.stages.find((s) => s.kind === 'lost')?.id, name: lost.trim(), probability: 0, kind: 'lost' as const },
          ],
        },
      }),
    onSuccess: () => {
      // Stage names show on deals everywhere, and a stage that changed kind closes or reopens its deals.
      invalidateSales()
      onDone()
    },
  })

  const change = (key: string, fields: Partial<DraftStage>) => setOpen((stages) => stages.map((s) => (s.key === key ? { ...s, ...fields } : s)))
  const move = (index: number, by: -1 | 1) =>
    setOpen((stages) => {
      const next = [...stages]
      ;[next[index], next[index + by]] = [next[index + by], next[index]]
      return next
    })
  const add = () => {
    const last = open[open.length - 1]
    const probability = last ? Math.min(90, percent(last.probability) + 10) : 10
    setOpen((stages) => [...stages, { key: `new-${nextKey.current++}`, name: '', probability: String(probability) }])
  }

  const canSave = name.trim() && won.trim() && lost.trim() && open.length > 0 && open.every((s) => s.name.trim())

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) save.mutate()
      }}
    >
      <Field label="Pipeline name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
      </Field>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <span className="flex-1">Stages</span>
          <span className="w-24 text-right hidden sm:block">Chance of winning</span>
          {/* Room for the move and remove buttons. */}
          <span className="w-[110px] hidden sm:block" />
        </div>

        <ol className="flex flex-col gap-2">
          {open.map((s, i) => (
            <li key={s.key} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <input
                aria-label={`Stage ${i + 1} name`}
                value={s.name}
                autoFocus={!s.id && i === open.length - 1}
                onChange={(e) => change(s.key, { name: e.target.value })}
                placeholder="Stage name"
                className={`${INPUT_CLASS} flex-1 min-w-0 basis-full sm:basis-auto`}
              />
              <div className="relative w-24 ml-auto sm:ml-0 shrink-0">
                <input
                  aria-label={`Chance of winning at ${s.name || `stage ${i + 1}`}`}
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  value={s.probability}
                  onChange={(e) => change(s.key, { probability: e.target.value })}
                  className={`${INPUT_CLASS} pr-7 text-right tabular-nums`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">%</span>
              </div>
              <div className="flex items-center shrink-0">
                <Button type="button" variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move stage up" leftIcon={<ArrowUp className="w-4 h-4" />} />
                <Button type="button" variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i === open.length - 1} aria-label="Move stage down" leftIcon={<ArrowDown className="w-4 h-4" />} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen((stages) => stages.filter((x) => x.key !== s.key))}
                  disabled={open.length === 1}
                  aria-label={`Remove ${s.name || 'stage'}`}
                  title={open.length === 1 ? 'A pipeline needs at least one open stage' : 'Remove stage'}
                  className="hover:!bg-destructive/10 hover:!text-destructive"
                  leftIcon={<X className="w-4 h-4" />}
                />
              </div>
            </li>
          ))}
        </ol>

        <div>
          <Button type="button" variant="outline" size="sm" onClick={add} disabled={open.length >= 18} leftIcon={<Plus className="w-3.5 h-3.5" />}>
            Add stage
          </Button>
        </div>

        <div className="flex flex-col gap-2 pt-3 border-t border-border/70">
          <p className="text-xs text-muted-foreground">Deals moved here are closed. These always come last, and you can rename them.</p>
          <ClosedStage label="Won stage" value={won} onChange={setWon} probability={100} />
          <ClosedStage label="Lost stage" value={lost} onChange={setLost} probability={0} />
        </div>
      </div>

      {save.error && <Notice level="error">{save.error.message}</Notice>}
      {/* Bottom-left, main action first, as every Settings block has them. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" isLoading={save.isPending} disabled={!canSave}>
          Save pipeline
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ClosedStage({ label, value, onChange, probability }: { label: string; value: string; onChange: (v: string) => void; probability: number }) {
  return (
    <div className="flex items-center gap-2">
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT_CLASS} flex-1 min-w-0`} />
      <span className="w-24 text-right pr-3 text-sm text-muted-foreground tabular-nums shrink-0">{probability}%</span>
      <span className="w-[110px] hidden sm:block" />
    </div>
  )
}
