// Client-side sign-in state, for redirecting between the login page and the
// app. The session cookie is HttpOnly, so the page can't read it; it asks the
// server instead, remembering the answer briefly so navigating doesn't make a
// request every time. The server checks the session on every data request
// regardless, so this only decides which screen to show.

import { checkAuthFn } from '../server/functions/auth'

const TTL_MS = 60_000
let known: { signedIn: boolean; at: number } | null = null

export async function isSignedIn(): Promise<boolean> {
  if (known && Date.now() - known.at < TTL_MS) return known.signedIn
  let signedIn = false
  try {
    signedIn = (await checkAuthFn()).isAuthenticated
  } catch {
    // Treat an unreachable server as signed out; the login page says why.
  }
  known = { signedIn, at: Date.now() }
  return signedIn
}

export function markSignedIn() {
  known = { signedIn: true, at: Date.now() }
}

export function markSignedOut() {
  known = { signedIn: false, at: Date.now() }
  if (typeof document !== 'undefined') {
    // Left by older versions, which kept sign-in state in readable cookies.
    document.cookie = 'is_authenticated=;path=/;expires=Thu, 01 Jan 1970 00:00:01 GMT;SameSite=Lax'
  }
}
