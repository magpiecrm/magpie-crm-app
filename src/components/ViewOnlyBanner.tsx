import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { queryKeys } from '../queryKeys'
import { checkAuthFn } from '../server/functions'
import { useSignOut } from '../hooks/useSignOut'
import { VIEW_ONLY_REFUSED, VIEW_ONLY_REFUSED_EVENT } from '../viewOnly'

/** How long the banner says an action was refused, before going back to saying what this is. */
const REFUSED_MS = 4000

/** Shown in a view-only session: what it is, the way out, and when something was refused. Nobody else sees it. */
export function ViewOnlyBanner() {
  const { data: account } = useQuery({ queryKey: queryKeys.account(), queryFn: () => checkAuthFn(), staleTime: 5 * 60_000 })
  const signOut = useSignOut()
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const onRefused = () => {
      setRefused(true)
      clearTimeout(timer)
      timer = setTimeout(() => setRefused(false), REFUSED_MS)
    }
    window.addEventListener(VIEW_ONLY_REFUSED_EVENT, onRefused)
    return () => {
      clearTimeout(timer)
      window.removeEventListener(VIEW_ONLY_REFUSED_EVENT, onRefused)
    }
  }, [])

  if (!account?.isAuthenticated || !account.viewOnly) return null
  return (
    <div
      role="status"
      title={refused ? VIEW_ONLY_REFUSED : 'Viewing as customer. Nothing can be changed.'}
      className={`inline-flex max-w-full items-center gap-2 rounded-md-s border px-2 py-1 text-xs leading-tight whitespace-nowrap text-foreground ${
        refused ? 'border-destructive/40 bg-destructive/10' : 'border-amber-500/30 bg-amber-500/10'
      }`}
    >
      <Eye className={`h-4 w-4 shrink-0 ${refused ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`} />
      {/* Sized to the header's free space, which the copilot panel narrows as well as the screen. */}
      <span className="hidden @[9rem]:inline @md:hidden">{refused ? 'Not changed' : 'View only'}</span>
      <span className="hidden @md:inline">{refused ? VIEW_ONLY_REFUSED : 'Viewing as customer. Nothing can be changed.'}</span>
      <button type="button" onClick={signOut} className="cursor-pointer rounded px-1 font-semibold underline underline-offset-2 hover:text-accent">
        Exit
      </button>
    </div>
  )
}
