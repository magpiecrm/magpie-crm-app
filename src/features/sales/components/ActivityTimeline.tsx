import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Plus, StickyNote, Trash2 } from 'lucide-react'
import { addNoteFn, deleteNoteFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import type { Activity } from '../types'

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const ICON = { note: StickyNote, created: Plus, stage_change: ArrowRight, task: StickyNote } as const

/**
 * A deal's or company's history, newest first, with a box to add a note.
 * `onChanged` runs after a note is added or deleted, so the page can refetch.
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
                {a.kind === 'note' ? (
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">{a.body}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">{a.body}</p>
                )}
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
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
