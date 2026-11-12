import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import {
  addDraftedPersonasFn,
  dismissPersonaDraftFn,
  dismissSearchSuggestionFn,
  personaDraftFn,
  searchSuggestionFn,
  startPersonaDraftFn,
  startSearchSuggestionFn,
} from '../../server/functions'
import type { AiRun, AiRunKind } from '../../server/prospecting/aiRuns'
import type { PersonaDraft } from '../../server/prospecting/personaDraft'
import type { SearchSuggestion } from '../../server/prospecting/searchSuggest'

// The AI's persona draft and suggested search run on the server
// (server/prospecting/aiRuns.ts), so their pop-ups can close and their pages
// be left while they go. These follow one: asked after every few seconds
// while it runs, and not at all once it's finished.

const POLL_MS = 3_000

function useAiRun<T, Input>(
  kind: AiRunKind,
  fns: { get: () => Promise<AiRun<T> | null>; start: (input: Input) => Promise<AiRun<T>>; dismiss: (id: string) => Promise<unknown> },
) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.prospects.aiRun(kind)
  const { data: run = null, isLoading } = useQuery({
    queryKey,
    queryFn: fns.get,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? POLL_MS : false),
  })

  // A run seen running that's then gone was stopped somewhere else, or the app restarted under it.
  const seen = useRef<AiRun<T> | null>(null)
  const [lost, setLost] = useState(false)
  useEffect(() => {
    if (seen.current?.status === 'running' && !run) setLost(true)
    else if (run) setLost(false)
    seen.current = run
  }, [run])

  const set = (next: AiRun<T> | null) => {
    seen.current = next
    setLost(false)
    queryClient.setQueryData(queryKey, next)
  }
  const start = useMutation({ mutationFn: fns.start, onSuccess: set })
  const dismiss = useMutation({
    mutationFn: (id: string) => fns.dismiss(id),
    onMutate: () => set(null),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })
  return { run, isLoading, lost, set, start, dismiss }
}

/** The AI's persona draft, for the Personas page and its pop-up. */
export function usePersonaDraft() {
  const queryClient = useQueryClient()
  const draft = useAiRun<PersonaDraft[], { websiteUrl: string; note?: string }>('personas', {
    get: () => personaDraftFn(),
    start: (data) => startPersonaDraftFn({ data }),
    dismiss: (id) => dismissPersonaDraftFn({ data: { id } }),
  })
  const add = useMutation({
    mutationFn: (which: number[]) => addDraftedPersonasFn({ data: { id: draft.run!.id, which } }),
    onSuccess: draft.set,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.prospects.personas() }),
  })
  const drafts = draft.run?.status === 'done' ? (draft.run.result ?? []) : []
  /** The drafts not yet added, by their place in the list. */
  const left = drafts.map((_, i) => i).filter((i) => !draft.run?.added?.includes(i))
  return { ...draft, drafts, left, add }
}

export type PersonaDraftState = ReturnType<typeof usePersonaDraft>

/** The AI's suggested search, for Prospect Search's button and its pop-up. */
export function useSearchSuggestion() {
  return useAiRun<SearchSuggestion, { websiteUrl: string }>('search', {
    get: () => searchSuggestionFn(),
    start: (data) => startSearchSuggestionFn({ data }),
    dismiss: (id) => dismissSearchSuggestionFn({ data: { id } }),
  })
}

export type SearchSuggestionState = ReturnType<typeof useSearchSuggestion>
