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
  const saveFormat = useMutation({
    mutationFn: (allowFormatConfirmed: boolean) => saveSearchPreferencesFn({ data: { allowFormatConfirmed } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.prospects.status() }),
  })
  const verifiedOnly = status?.verification.verifiedOnly ?? true
  const hideUnverifiable = save.isPending ? save.variables : (status?.verification.hideUnverifiable ?? true)
  const allowFormatConfirmed = saveFormat.isPending ? saveFormat.variables : (status?.verification.allowFormatConfirmed ?? false)

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

      <SettingsBlock
        title="Companies that accept every address"
        description={
          <>
            <p>
              At these companies the mail server can't confirm any address, so emails there are normally withheld. Often
              their address format is still clear: several addresses you already have there follow it, or the mail server
              confirmed it before.
            </p>
            <p>
              These addresses are marked Format confirmed. They're right most of the time but can still bounce, so a
              campaign sends them in a first batch of 50 and holds the rest for an hour. If more than 2% of that batch
              bounces, the rest aren't sent until you choose to.
            </p>
            {!verifiedOnly && <p>Email verification is set to hand over unconfirmed guesses too, so these are always handed over.</p>}
          </>
        }
      >
        <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-border text-accent focus:ring-accent"
            checked={allowFormatConfirmed}
            disabled={!status || !verifiedOnly || saveFormat.isPending}
            onChange={(e) => saveFormat.mutate(e.target.checked)}
          />
          <span>
            <span className="font-semibold">Hand over addresses whose format is confirmed</span>
            <span className="block text-[11px] text-muted-foreground leading-snug max-w-xl">
              On: Reveal and saving give these addresses, and search shows people at those companies. Off: only verified
              addresses are handed over.
            </span>
          </span>
        </label>
        {saveFormat.isError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5" /> {(saveFormat.error as Error).message}
          </p>
        )}
        {saveFormat.isSuccess && !saveFormat.isPending && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saved. Your next search uses it.
          </p>
        )}
      </SettingsBlock>
    </div>
  )
}
