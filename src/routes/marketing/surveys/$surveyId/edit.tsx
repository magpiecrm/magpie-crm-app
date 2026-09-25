import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { queryKeys } from '../../../../queryKeys'
import { getSurveyFn } from '../../../../server/functions'
import { SurveyBuilder } from '../../../../features/survey-builder/SurveyBuilderContainer'

export const Route = createFileRoute('/marketing/surveys/$surveyId/edit')({
  component: SurveyEditPage,
})

function SurveyEditPage() {
  const { surveyId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: survey, isLoading, error } = useQuery({
    queryKey: queryKeys.surveys.survey(surveyId),
    queryFn: () => getSurveyFn({ data: { id: surveyId } }),
    // The builder owns the design once open; a background refetch must not reset it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-55 bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (error || !survey) {
    return <div className="p-8 text-destructive">{error?.message ?? 'Survey not found'}</div>
  }

  return (
    <SurveyBuilder
      key={survey.id}
      survey={survey}
      onClose={() => navigate({ to: '/marketing/surveys/$surveyId', params: { surveyId } })}
      onSaved={saved => {
        queryClient.setQueryData(queryKeys.surveys.survey(surveyId), { ...survey, ...saved })
        queryClient.invalidateQueries({ queryKey: queryKeys.surveys.list(), exact: true })
      }}
    />
  )
}
