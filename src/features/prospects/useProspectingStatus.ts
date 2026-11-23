import { useQuery } from '@tanstack/react-query'
import { useHydrated } from '@tanstack/react-router'
import { queryKeys } from '../../queryKeys'
import { prospectingStatusFn } from '../../server/functions'

/**
 * How this copy searches (hosted, verification, signals, demo), for a page that
 * renders from it: Prospect Search and the persona form.
 *
 * The sidebar asks for the same status. React hydrates a page after the layout
 * around it, so the sidebar's answer can already be cached when the page
 * hydrates. Rendering from it then (hosted, so no notes about credits) differs
 * from what the server sent with no status, and hydration fails (React error
 * #418). So until the page has hydrated it gets no status, as on the server,
 * and the cached one straight after.
 */
export function useProspectingStatus() {
  const hydrated = useHydrated()
  const { data } = useQuery({ queryKey: queryKeys.prospects.status(), queryFn: () => prospectingStatusFn() })
  return hydrated ? data : undefined
}
