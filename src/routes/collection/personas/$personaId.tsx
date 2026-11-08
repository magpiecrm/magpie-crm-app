import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, MoreHorizontal, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { createPersonaFn, deletePersonaFn, getPersonaFn, updatePersonaFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { PersonaForm, type AfterSave, type PersonaFormValues } from '../../../features/prospects/components/PersonaForm'

export const Route = createFileRoute('/collection/personas/$personaId')({
  component: EditPersonaPage,
})

/** The page's less-used actions behind one button: Duplicate, and Delete (which asks first, in the header). */
function MoreActions({ onDuplicate, onDelete, duplicating }: { onDuplicate: () => void; onDelete: () => void; duplicating: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  const item = 'flex w-full items-center gap-2 rounded-md-xs px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none cursor-pointer'
  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} isLoading={duplicating} leftIcon={<MoreHorizontal className="h-4 w-4" />} onClick={() => setOpen(o => !o)} />
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 rounded-md-s border border-border bg-popover p-1 shadow-lg">
          <button role="menuitem" type="button" className={`${item} text-foreground`} onClick={() => { setOpen(false); onDuplicate() }}>
            <Copy aria-hidden className="h-4 w-4 text-muted-foreground" /> Duplicate
          </button>
          <button role="menuitem" type="button" className={`${item} text-destructive`} onClick={() => { setOpen(false); onDelete() }}>
            <Trash2 aria-hidden className="h-4 w-4" /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

function EditPersonaPage() {
  const { personaId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: persona, isLoading } = useQuery({
    queryKey: queryKeys.prospects.persona(personaId),
    queryFn: () => getPersonaFn({ data: { id: personaId } }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ data }: { data: PersonaFormValues; then: AfterSave }) => updatePersonaFn({ data: { id: personaId, updates: data } }),
    onSuccess: (_result, { data, then }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects.personas() })
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects.persona(personaId) })
      if (then === 'search') {
        // As the list's Use in Prospect Search does; the id marks the contacts its search saves.
        sessionStorage.setItem('applyPersona', JSON.stringify({ ...data, id: personaId }))
        navigate({ to: '/collection/prospect-search' })
      } else {
        navigate({ to: '/collection/personas' })
      }
    },
  })

  // A copy of what's in the form now, unsaved edits included, opened to edit.
  const duplicate = useMutation({
    mutationFn: (current: PersonaFormValues) =>
      createPersonaFn({
        data: {
          name: `${current.name.trim() || 'Untitled persona'} (copy)`,
          description: current.description,
          criteria: current.criteria,
          painPoints: current.painPoints,
          valueProp: current.valueProp,
        },
      }),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects.personas() })
      navigate({ to: '/collection/personas/$personaId', params: { personaId: id } })
    },
  })

  const remove = useMutation({
    mutationFn: () => deletePersonaFn({ data: { id: personaId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects.personas() })
      navigate({ to: '/collection/personas' })
    },
  })

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
        <div className="animate-pulse h-4 w-24 bg-muted rounded-md-xs mb-6"></div>
        <div className="animate-pulse h-8 w-64 bg-muted rounded-md-s mb-8"></div>
        <div className="animate-pulse h-64 bg-muted rounded-md-m"></div>
      </div>
    )
  }

  if (!persona) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
        <h1 className="text-2xl font-display text-foreground mb-2">Persona not found</h1>
        <p className="text-sm text-muted-foreground mb-4">It may have been deleted.</p>
        <Link to="/collection/personas" className="text-sm font-medium text-accent hover:underline">
          Back to personas
        </Link>
      </div>
    )
  }

  const saved = new Date(persona.updated_at)
  const failed = updateMutation.error ?? duplicate.error ?? remove.error

  return (
    <PersonaForm
      key={personaId}
      title={persona.name || 'Edit persona'}
      subtitle={Number.isNaN(saved.getTime()) ? undefined : `Last saved ${saved.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`}
      initial={persona}
      onSave={(data, then) => updateMutation.mutate({ data, then })}
      isSaving={updateMutation.isPending}
      error={failed ? failed.message : null}
      actions={current =>
        confirmDelete ? (
          <>
            <span className="text-sm text-foreground">Delete this persona?</span>
            <Button variant="danger" size="sm" isLoading={remove.isPending} onClick={() => remove.mutate()}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
          </>
        ) : (
          <MoreActions duplicating={duplicate.isPending} onDuplicate={() => duplicate.mutate(current)} onDelete={() => setConfirmDelete(true)} />
        )
      }
    />
  )
}
