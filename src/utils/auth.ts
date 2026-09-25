// Client-side authentication helpers

export function getAuthCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(^| )is_authenticated=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

export function setAuthCookie(value: string, days = 7) {
  if (typeof document === 'undefined') return
  const date = new Date()
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000)
  document.cookie = `is_authenticated=${encodeURIComponent(value)};path=/;expires=${date.toUTCString()};SameSite=Lax`
}

export function clearAuthCookie() {
  if (typeof document === 'undefined') return
  document.cookie = 'is_authenticated=;path=/;expires=Thu, 01 Jan 1970 00:00:01 GMT;SameSite=Lax'
  // Also clear the auth_token cookie from server side (since auth_token might have been set by server)
  document.cookie = 'auth_token=;path=/;expires=Thu, 01 Jan 1970 00:00:01 GMT;SameSite=Lax'
}

export function isAuthenticated(): boolean {
  return !!getAuthCookie()
}

