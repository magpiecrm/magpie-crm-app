import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AlarmClock, ArrowRight, Plus, StickyNote, Trash2 } from 'lucide-react'
import { addNoteFn, deleteNoteFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { TaskComposer, TaskRow } from './TaskParts'
import type { Activity } from '../types'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const ICON = { note: StickyNote, created: Plus, stage_change: ArrowRight, task: AlarmClock } as const

/**
 * A deal's or company's history, newest first, with a box to add a note or a
 * task. `onChanged` runs after a note or task is added, changed or deleted, so
 * the page can refetch.
 */
export function ActivityTimeline({
  activities,
  on,
  onChanged,
}: {
  activities: Activity[]
  /** What a new note is attached to. */
  on: { dealId?: string; companyId?: string }
  onChanged: () => void
}) {
  const [mode, setMode] = useState<'note' | 'task'>('note')
  const [body, setBody] = useState('')
  const add = useMutation({
    mutationFn: () => addNoteFn({ data: { ...on, body } }),
    onSuccess: () => {
      setBody('')
      onChanged()
    },
  })
  const remove = useMutation({ mutationFn: (id: string) => deleteNoteFn({ data: { id } }), onSuccess: onChanged })

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Add" className="inline-flex rounded-lg border border-border p-0.5 text-xs">
        {(['note', 'task'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
              mode === m ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {m === 'note' ? 'Note' : 'Task'}
          </button>
        ))}
      </div>
      {mode === 'task' ? (
        <TaskComposer on={on} onDone={onChanged} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (body.trim()) add.mutate()
          }}
          className="space-y-2"
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) add.mutate()
            }}
            rows={3}
            placeholder="Add a note…"
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:ring-1 focus:ring-accent outline-none resize-y"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-destructive">{(add.error as Error | null)?.message}</span>
            <Button type="submit" size="sm" isLoading={add.isPending} disabled={!body.trim()}>
              Add note
            </Button>
          </div>
        </form>
      )}

      {activities.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Nothing here yet.</p>
      ) : (
        <ol className="relative border-l border-border pl-6 space-y-5">
          {activities.map((a) => {
            const Icon = ICON[a.kind]
            return (
              <li key={a.id} className="relative group">
                <span
                  className={`absolute -left-[33px] top-0 rounded-full p-1 border-4 border-card ${
                    a.kind === 'note' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                </span>
                {a.kind === 'task' ? (
                  <TaskRow task={a} onChanged={onChanged} />
                ) : a.kind === 'note' ? (
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">{a.body}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">{a.body}</p>
                )}
                {a.kind !== 'task' && (
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{when(a.created_at)}</span>
                    {a.created_by && <span>· {a.created_by}</span>}
                    {a.kind === 'note' && (
                      <button
                        type="button"
                        onClick={() => remove.mutate(a.id)}
                        aria-label="Delete note"
                        className="ml-1 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-destructive transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
