import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { createPersonaFn } from '../../../server/functions'
import { PersonaForm, type PersonaFormValues } from '../../../features/prospects/components/PersonaForm'
import { DEFAULT_PERSONA_CRITERIA } from '../../../features/prospects/types'

export const Route = createFileRoute('/collection/personas/new')({
  component: NewPersonaPage,
})

const DEFAULT_PERSONA: PersonaFormValues = {
  name: '',
  description: '',
  criteria: DEFAULT_PERSONA_CRITERIA,
  painPoints: '',
  valueProp: '',
}

function NewPersonaPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: (data: PersonaFormValues) => createPersonaFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects.personas() })
      navigate({ to: '/collection/personas' })
    },
  })

  return (
    <PersonaForm
      title="New Persona"
      initial={DEFAULT_PERSONA}
      onSave={data => createMutation.mutate(data)}
      isSaving={createMutation.isPending}
    />
  )
}
