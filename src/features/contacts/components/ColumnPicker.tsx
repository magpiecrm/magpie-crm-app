import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Lock, Plus, RotateCcw } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { saveContactColumnsFn } from '../../../server/functions'
import { BUILTIN_COLUMNS, columnLabel, PINNED_COLUMN } from '../contactColumns'
import { invalidateContactFields } from '../contactCache'
import { FIELD_LIMITS, type ContactFieldDef, type ContactTableView } from '../contactFields'
import { ContactFieldForm } from './ContactFieldForm'

const SECTION = 'flex items-center gap-2 text-[13px] font-semibold text-foreground'
const LIST = 'flex flex-col divide-y divide-border overflow-hidden rounded-md-s border border-border'
const ROW = 'flex min-h-10 items-center gap-2.5 px-3 py-1.5 text-sm'
const CHECK = 'h-4 w-4 shrink-0 accent-[var(--accent)] cursor-pointer'

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
    <Dialog
      isOpen
      onClose={onClose}
      title="Columns"
      description="Shared by everyone in the workspace. Drag to reorder."
      className="sm:max-w-md"
    >
      <DialogBody className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className={SECTION}>
            Shown <span className="rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">{shown.length + 1}</span>
          </h3>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={move}>
            <SortableContext items={shown} strategy={verticalListSortingStrategy}>
              <ul className={LIST}>
                <li className={`${ROW} text-foreground`}>
                  <span className="w-4 shrink-0" />
                  <input type="checkbox" checked disabled aria-label="Contact is always shown" className={CHECK} />
                  <span className="flex-1">Contact</span>
                  <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    Always shown
                  </span>
                </li>
                {shown.map((id) => (
                  <ColumnRow key={id} id={id} label={columnLabel(id, fields) ?? id} onHide={() => setShown((all) => all.filter((x) => x !== id))} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </section>
        {hidden.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className={SECTION}>
              Hidden <span className="rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">{hidden.length}</span>
            </h3>
            <ul className={LIST}>
              {hidden.map((id) => (
                <li key={id}>
                  <label className={`${ROW} text-foreground ${full ? 'opacity-60' : 'cursor-pointer hover:bg-muted/50'}`}>
                    <input type="checkbox" checked={false} disabled={full} onChange={() => setShown((all) => [...all, id])} className={CHECK} />
                    <span className="truncate">{columnLabel(id, fields) ?? id}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Button
          variant="ghost"
          className="-mt-2 -ml-3 self-start !text-foreground"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => {
            onClose()
            onAddColumn()
          }}
        >
          Add a column
        </Button>
        {full && <Notice>A table can show up to {FIELD_LIMITS.visibleColumns} columns.</Notice>}
        {save.error && <Notice level="error">{save.error.message}</Notice>}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" className="sm:-ml-3 sm:mr-auto !text-foreground" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={() => save.mutate(null)}>
          Reset to defaults
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => save.mutate([PINNED_COLUMN, ...shown])} isLoading={save.isPending}>
          Save columns
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function ColumnRow({ id, label, onHide }: { id: string; label: string; onHide: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`${ROW} bg-card text-foreground ${isDragging ? 'relative z-10 rounded-md-s shadow-md' : ''}`}>
      <button type="button" {...attributes} {...listeners} aria-label={`Move ${label}`} className="-m-1.5 shrink-0 touch-none cursor-grab rounded-md-xs p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <GripVertical className="h-4 w-4" />
      </button>
      <label className="flex min-w-0 flex-1 items-center gap-2.5 cursor-pointer">
        <input type="checkbox" checked onChange={onHide} className={CHECK} />
        <span className="truncate">{label}</span>
      </label>
    </li>
  )
}

/** A new custom field, shown on the table it was added from. */
export function AddColumnDialog({ view, onClose }: { view: ContactTableView; onClose: () => void }) {
  const queryClient = useQueryClient()
  return (
    <Dialog isOpen onClose={onClose} title="Add a column" description="A new contact field, shown as a column in this table." className="sm:max-w-lg">
      <ContactFieldForm
        showIn={view}
        submitLabel="Add column"
        onCreated={() => {
          invalidateContactFields(queryClient)
          onClose()
        }}
        onCancel={onClose}
      />
    </Dialog>
  )
}
