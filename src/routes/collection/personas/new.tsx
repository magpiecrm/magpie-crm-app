import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { createPersonaFn } from '../../../server/functions'
import { PersonaForm, type AfterSave, type PersonaFormValues } from '../../../features/prospects/components/PersonaForm'
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
    mutationFn: ({ data }: { data: PersonaFormValues; then: AfterSave }) => createPersonaFn({ data }),
    onSuccess: ({ id }, { data, then }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.prospects.personas() })
      if (then === 'search') {
        // As the list's Use in Prospect Search does; the id marks the contacts its search saves.
        sessionStorage.setItem('applyPersona', JSON.stringify({ ...data, id }))
        navigate({ to: '/collection/prospect-search' })
      } else {
        navigate({ to: '/collection/personas' })
      }
    },
  })

  return (
    <PersonaForm
      title="New persona"
      initial={DEFAULT_PERSONA}
      onSave={(data, then) => createMutation.mutate({ data, then })}
      isSaving={createMutation.isPending}
      error={createMutation.error ? createMutation.error.message : null}
    />
  )
}
