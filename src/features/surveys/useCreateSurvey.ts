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
  // Made, the page stays busy until the builder opens (that takes a moment more): a second pick
  // in between would make a second survey. A failure frees it to try again.
  const busy = create.isPending || create.isSuccess
  return {
    pick: (templateId: string) => {
      if (!busy) create.mutate(templateId)
    },
    pending: busy ? (create.variables ?? null) : null,
    error: create.error?.message,
  }
}
