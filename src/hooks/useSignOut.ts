import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { logoutFn } from '../server/functions'
import { markSignedOut } from '../utils/auth'

/** Signs out and goes to the sign-in page. */
export function useSignOut() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return async () => {
    // Ends the session on the server too, so the cookie can't be reused.
    await logoutFn().catch(() => {})
    markSignedOut()
    // Signing out ends the session's working data too: search results,
    // revealed emails and saved filters, so the next person to sign in on
    // this tab doesn't see them.
    queryClient.clear()
    try {
      sessionStorage.clear()
    } catch {
      // storage unavailable; nothing was kept there
    }
    navigate({ to: '/login' })
  }
}
