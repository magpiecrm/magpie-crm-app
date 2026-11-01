import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { saveContactColumnsFn } from '../../../server/functions'
import { BUILTIN_COLUMNS, columnLabel, PINNED_COLUMN } from '../contactColumns'
import { invalidateContactFields } from '../contactCache'
import { FIELD_LIMITS, type ContactFieldDef, type ContactTableView } from '../contactFields'
import { ContactFieldForm } from './ContactFieldForm'

/** Which columns a table shows and in what order, for everyone in the workspace. Saved once, on Save. */
export function ColumnPicker({
  view,
  columns,
  fields,
  onClose,
  onAddColumn,
}: {
  view: ContactTableView
  columns: string[]
  fields: ContactFieldDef[]
  onClose: () => void
  onAddColumn: () => void
}) {
  const queryClient = useQueryClient()
  const [shown, setShown] = useState(columns.filter((id) => id !== PINNED_COLUMN))
  const save = useMutation({
    mutationFn: (next: string[] | null) => saveContactColumnsFn({ data: { view, columns: next } }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.email.contactColumns(), saved)
      onClose()
    },
  })
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const hidden = [...BUILTIN_COLUMNS.map((c) => c.id), ...fields.map((f) => `custom:${f.key}`)].filter((id) => id !== PINNED_COLUMN && !shown.includes(id))
  const full = shown.length + 1 >= FIELD_LIMITS.visibleColumns

  const move = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    setShown((all) => arrayMove(all, all.indexOf(String(active.id)), all.indexOf(String(over.id))))
  }

  return (
    <Dialog isOpen onClose={onClose} title="Columns" className="max-w-md" padded>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">Everyone in this workspace sees the same columns. Drag to reorder.</p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={move}>
          <SortableContext items={shown} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-1">
              <li className="flex items-center gap-2 rounded-md-s px-2 py-1.5 text-sm text-muted-foreground">
                <span className="w-4" />
                <input type="checkbox" checked disabled aria-label="Contact is always shown" className="w-4 h-4 accent-accent" />
                Contact
              </li>
              {shown.map((id) => (
                <ColumnRow key={id} id={id} label={columnLabel(id, fields) ?? id} onHide={() => setShown((all) => all.filter((x) => x !== id))} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        {hidden.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <span className="text-xs font-semibold text-muted-foreground">Hidden</span>
            {hidden.map((id) => (
              <label key={id} className={`flex items-center gap-2 rounded-md-s px-2 py-1.5 text-sm text-foreground ${full ? 'opacity-50' : 'cursor-pointer hover:bg-muted/40'}`}>
                <span className="w-4" />
                <input type="checkbox" checked={false} disabled={full} onChange={() => setShown((all) => [...all, id])} className="w-4 h-4 accent-accent" />
                {columnLabel(id, fields) ?? id}
              </label>
            ))}
          </div>
        )}
        {full && <Notice>A table can show up to {FIELD_LIMITS.visibleColumns} columns.</Notice>}
        {save.error && <Notice level="error">{save.error.message}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => save.mutate([PINNED_COLUMN, ...shown])} isLoading={save.isPending}>
            Save
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={() => save.mutate(null)}>
            Reset to defaults
          </Button>
          <Button
            variant="ghost"
            className="sm:ml-auto"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => {
              onClose()
              onAddColumn()
            }}
          >
            Add column
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function ColumnRow({ id, label, onHide }: { id: string; label: string; onHide: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-2 rounded-md-s bg-card px-2 py-1.5 text-sm text-foreground ${isDragging ? 'relative z-10 shadow-md' : ''}`}>
      <button type="button" {...attributes} {...listeners} aria-label={`Move ${label}`} className="touch-none cursor-grab text-muted-foreground hover:text-foreground">
        <GripVertical className="h-4 w-4" />
      </button>
      <label className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer">
        <input type="checkbox" checked onChange={onHide} className="w-4 h-4 accent-accent" />
        <span className="truncate">{label}</span>
      </label>
    </li>
  )
}

/** A new custom field, shown on the table it was added from. */
export function AddColumnDialog({ view, onClose }: { view: ContactTableView; onClose: () => void }) {
  const queryClient = useQueryClient()
  return (
    <Dialog isOpen onClose={onClose} title="Add column" className="max-w-lg" padded>
      <ContactFieldForm
        showIn={view}
        submitLabel="Add column"
        onCreated={() => {
          invalidateContactFields(queryClient)
          onClose()
        }}
        extraActions={
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        }
      />
    </Dialog>
  )
}
