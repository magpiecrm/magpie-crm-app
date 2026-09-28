import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import { pipelinesFn } from '../../server/functions'

/** The pipelines in order (the first is the default) and the people who can own deals and companies. */
export function usePipelines() {
  return useQuery({ queryKey: queryKeys.sales.pipelines(), queryFn: () => pipelinesFn() })
}

/**
 * Refreshes every sales query: companies, pipelines, deal lists and open deal
 * pages. For changes whose names show everywhere, like renaming a company or a stage.
 */
export function useInvalidateSales() {
  const queryClient = useQueryClient()
  const [namespace] = queryKeys.sales.pipelines()
  return () => queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === namespace })
}
