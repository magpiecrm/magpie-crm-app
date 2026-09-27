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
    mutationFn: (hideUnverifiable: boolean) => saveSearchPreferencesFn({ data: { hideUnverifiable } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.prospects.status() }),
  })
  const verifiedOnly = status?.verification.verifiedOnly ?? true
  const hideUnverifiable = save.isPending ? save.variables : (status?.verification.hideUnverifiable ?? true)

  return (
    <div className="flex flex-col gap-6">
      <SettingsBlock
        title="People whose email can't be verified"
        description={
          <>
            <p>
              Some people can't get a verified email: their company's mail server accepts every address, real or not,
              or doesn't take email, or a lookup already found nothing that works.
            </p>
            <p>
              People whose lookup failed for a reason a retry won't change are remembered for 90 days, as a scrambled
              code of their profile address, so later searches leave them out before paying to look them up again.
            </p>
            {!verifiedOnly && <p>Email verification is set to hand over unconfirmed guesses too, so these people are always shown.</p>}
          </>
        }
      >
        <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-border text-accent focus:ring-accent"
            checked={hideUnverifiable}
            disabled={!status || !verifiedOnly || save.isPending}
            onChange={(e) => save.mutate(e.target.checked)}
          />
          <span>
            <span className="font-semibold">Hide people whose email can't be verified (recommended)</span>
            <span className="block text-[11px] text-muted-foreground leading-snug max-w-xl">
              On: they're left out of results, and search keeps looking to fill the page. Off: they're listed, marked
              Unverifiable where the email would be.
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
