import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { queryKeys } from '../../queryKeys'
import { createSurveyFn } from '../../server/functions'
import { SURVEY_STARTER_TEMPLATES } from '../survey-builder/templates/starters'

/**
 * Make a survey from a starter and open it in the builder. It's named after
 * the starter; the name is changed in the builder's top bar.
 */
export function useCreateSurvey() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: (templateId: string) => {
      const template = SURVEY_STARTER_TEMPLATES.find(t => t.id === templateId)
      return createSurveyFn({ data: { name: templateId === 'blank' ? 'Untitled survey' : template?.name ?? 'Untitled survey', templateId } })
    },
    onSuccess: survey => {
      queryClient.invalidateQueries({ queryKey: queryKeys.surveys.list() })
      navigate({ to: '/marketing/surveys/$surveyId/edit', params: { surveyId: survey.id } })
    },
  })
  return { pick: (templateId: string) => create.mutate(templateId), pending: create.isPending ? (create.variables ?? null) : null, error: create.error?.message }
}
