import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { getPersonaFn, updatePersonaFn } from '../../../server/functions'
import { PersonaForm, type PersonaFormValues } from '../../../features/prospects/components/PersonaForm'

export const Route = createFileRoute('/collection/personas/$personaId')({
  component: EditPersonaPage,
})

function EditPersonaPage() {
  const { personaId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: persona, isLoading } = useQuery({
    queryKey: queryKeys.prospects.persona(personaId),
    queryFn: () => getPersonaFn({ data: { id: personaId } }),
  })

  const updateMutation = useMutation({
    mutationFn: (data: PersonaFormValues) => updatePersonaFn({ data: { id: personaId, updates: data } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects.personas() })
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects.persona(personaId) })
      navigate({ to: '/collection/personas' })
    },
  })

  if (isLoading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="animate-pulse h-8 w-64 bg-muted rounded mb-8"></div>
        <div className="animate-pulse h-64 bg-muted rounded"></div>
      </div>
    )
  }

  if (!persona) {
    return (
      <div className="p-4 lg:p-8 text-center">
        <h2 className="text-xl font-medium text-foreground mb-4">Persona not found</h2>
        <Link to="/collection/personas" className="text-accent hover:underline">
          Return to personas
        </Link>
      </div>
    )
  }

  return (
    <PersonaForm
      title={`Edit: ${persona.name}`}
      initial={persona}
      onSave={data => updateMutation.mutate(data)}
      isSaving={updateMutation.isPending}
    />
  )
}
