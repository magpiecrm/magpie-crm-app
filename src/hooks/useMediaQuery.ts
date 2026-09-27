import { useSyncExternalStore } from 'react'

/**
 * SSR-safe media query hook.
 *
 * Returns `false` on the server so the desktop tree is what gets rendered during
 * SSR; the client corrects itself on the first commit. Use this only for
 * *behavioural* branches (inline styles, which layout tree to mount, whether a
 * panel is a sheet or a rail). Anything purely cosmetic should stay in Tailwind
 * `sm:`/`md:`/`lg:` prefixes so it works before hydration.
 */
function useMediaQuery(query: string): boolean {
  const subscribe = (onChange: () => void) => {
    if (typeof window === 'undefined') return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** The app-wide desktop/mobile line. Matches Tailwind's `lg` breakpoint. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}
