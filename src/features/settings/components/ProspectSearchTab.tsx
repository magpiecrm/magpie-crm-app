import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { prospectingStatusFn, saveSearchPreferencesFn } from '../../../server/functions'
import { SettingsBlock } from './SettingsBlock'

/** Settings → Prospect search: what search results show. Hosted copies can change it too. */
export function ProspectSearchTab() {
  const queryClient = useQueryClient()
  const { data: status } = useQuery({ queryKey: queryKeys.prospects.status(), queryFn: () => prospectingStatusFn() })
  const save = useMutation({
    mutationFn: (showUnverifiable: boolean) => saveSearchPreferencesFn({ data: { showUnverifiable } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.prospects.status() }),
  })
  const verifiedOnly = status?.verification.verifiedOnly ?? true
  const showUnverifiable = save.isPending ? save.variables : (status?.verification.showUnverifiable ?? true)

  return (
    <div className="flex flex-col gap-6">
      <SettingsBlock
        title="People whose email can't be verified"
        description={
          <>
            <p>
              Some companies' mail servers accept every address, real or not, so no email there can be confirmed. You
              still see who they are, with their current title and company.
            </p>
            {!verifiedOnly && <p>Email verification is set to hand over unconfirmed guesses too, so these people are always shown.</p>}
          </>
        }
      >
        <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-border text-accent focus:ring-accent"
            checked={showUnverifiable}
            disabled={!status || !verifiedOnly || save.isPending}
            onChange={(e) => save.mutate(e.target.checked)}
          />
          <span>
            <span className="font-semibold">Show them in search results, marked Unverifiable</span>
            <span className="block text-[11px] text-muted-foreground leading-snug max-w-xl">
              On: they're listed with Unverifiable where the email would be. Off: they're left out, and search keeps
              looking to fill the page, which uses more prospect credits.
            </span>
          </span>
        </label>
        {save.isError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5" /> {(save.error as Error).message}
          </p>
        )}
        {save.isSuccess && !save.isPending && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saved. Your next search uses it.
          </p>
        )}
      </SettingsBlock>
    </div>
  )
}
