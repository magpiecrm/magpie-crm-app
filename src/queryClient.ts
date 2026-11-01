import { QueryClient } from '@tanstack/react-query'
import { VIEW_ONLY_REFUSED } from './viewOnly'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      // React Query's three retries, without waiting on a refusal that won't change.
      retry: (failures, error) => failures < 3 && error.message !== VIEW_ONLY_REFUSED,
    },
  },
})
