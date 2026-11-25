import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { queryKeys } from '../../queryKeys'
import { createSurveyFn } from '../../server/functions'
import { SURVEY_STARTER_TEMPLATES } from '../survey-builder/templates/starters'

/**
 * Make a survey from a starter and open it in the builder. It's named after
 * the starter; the name is changed in the builder's top bar.
 *
 * One pick at a time: from the click until the builder has opened, the tiles
 * are busy and further picks do nothing, so a double click, or a click while
 * the builder loads, makes no second survey. Back before the builder opened,
 * or a failure, frees them again.
 */
export function useCreateSurvey() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Set at the click itself, before React has drawn the busy tiles: a very fast double click is one pick.
  const picking = useRef(false)
  const [opening, setOpening] = useState<string | null>(null)
  const done = () => {
    picking.current = false
    setOpening(null)
  }
  const create = useMutation({
    mutationFn: (templateId: string) => {
      const template = SURVEY_STARTER_TEMPLATES.find(t => t.id === templateId)
      return createSurveyFn({ data: { name: templateId === 'blank' ? 'Untitled survey' : template?.name ?? 'Untitled survey', templateId } })
    },
    // Marked out of date without refetching now: the empty Surveys page would otherwise turn into the list
    // (new draft, live buttons) before the builder opens. It's fetched again when next shown.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.surveys.list(), refetchType: 'none' }),
  })
  const pick = (templateId: string) => {
    if (picking.current) return
    picking.current = true
    setOpening(templateId)
    create.mutate(templateId, {
      // Only while this page is still open (these don't run once it's left): going elsewhere
      // while it's being made doesn't pull you into its builder a moment later.
      onSuccess: async survey => {
        await navigate({ to: '/marketing/surveys/$surveyId/edit', params: { surveyId: survey.id } })
        // The builder's open (or Back was pressed): the list is fetched now, in the background,
        // so going back to Surveys doesn't first show the old one ("Make your first survey").
        void queryClient.refetchQueries({ queryKey: queryKeys.surveys.list(), type: 'all' })
        // Still here: Back was pressed before the builder opened.
        done()
      },
      onError: done,
    })
  }
  return { pick, pending: opening, error: create.error?.message }
}
