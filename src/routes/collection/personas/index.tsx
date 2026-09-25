import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { Plus, UserCircle, Trash2, Pencil } from 'lucide-react'
import { getPersonasFn, deletePersonaFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import type { Persona, PersonaCriteria } from '../../../features/prospects/types'

export const Route = createFileRoute('/collection/personas/')({
  component: PersonasPage,
})

function criteriaSummary(criteria: PersonaCriteria) {
  const parts: string[] = []
  if (criteria.title.length) parts.push(`${criteria.title.length} title${criteria.title.length !== 1 ? 's' : ''}`)
  if (criteria.industry.length) parts.push(`${criteria.industry.length} industr${criteria.industry.length !== 1 ? 'ies' : 'y'}`)
  if (criteria.location.length) parts.push(`${criteria.location.length} location${criteria.location.length !== 1 ? 's' : ''}`)
  if (criteria.employeeCount) parts.push(criteria.employeeCount)
  return parts.length ? parts.join(' · ') : 'No criteria set'
}

function PersonasPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data: personas = [], isLoading } = useQuery({
    queryKey: queryKeys.prospects.personas(),
    queryFn: () => getPersonasFn(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePersonaFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.prospects.personas() }),
  })

  const confirmDelete = (persona: Persona) => {
    if (confirm(`Delete "${persona.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(persona.id)
    }
  }

  const useInSearch = (persona: Persona) => {
    sessionStorage.setItem('applyPersona', JSON.stringify(persona))
    navigate({ to: '/collection/prospect-search' })
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-2">Personas</h1>
          <p className="text-muted-foreground">Define reusable buyer personas — firmographic criteria and messaging notes — to drive prospect search.</p>
        </div>
        <Link
          to="/collection/personas/new"
          className="bg-accent text-accent-foreground px-6 py-2.5 rounded-md-s font-medium hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 shadow-accent cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          New Persona
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-40 border border-border rounded-md-m" />
          ))}
        </div>
      ) : (personas as Persona[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mb-4">
            <UserCircle className="w-8 h-8 text-accent" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">No personas yet</h3>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Create your first persona to define an ideal customer profile you can reuse in Prospect Search.
          </p>
          <Link
            to="/collection/personas/new"
            className="bg-accent text-accent-foreground px-5 py-2.5 rounded-md-s font-medium hover:brightness-110 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Create Persona
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(personas as Persona[]).map(persona => (
            <div
              key={persona.id}
              className="card border border-border rounded-md-m p-6 flex flex-col gap-4 relative group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-foreground truncate">{persona.name}</h3>
                  {persona.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{persona.description}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Link
                    to="/collection/personas/$personaId"
                    params={{ personaId: persona.id }}
                    className="p-1.5 rounded-md-s text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Link>
                  <button
                    onClick={() => confirmDelete(persona)}
                    className="p-1.5 rounded-md-s text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {persona.criteria.title.slice(0, 3).map(t => (
                  <Badge key={t} variant="default">{t}</Badge>
                ))}
                {persona.criteria.industry.slice(0, 2).map(i => (
                  <Badge key={i} variant="info">{i}</Badge>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">{criteriaSummary(persona.criteria)}</p>

              <button
                onClick={() => useInSearch(persona)}
                className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium border border-accent/30 text-accent rounded-md-s hover:bg-accent/10 transition-colors cursor-pointer mt-auto"
              >
                Use in Prospect Search
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
