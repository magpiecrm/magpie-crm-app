import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { prospectingStatusFn, saveSearchPreferencesFn } from '../../../server/functions'
import { SettingsBlock, SettingsCheck, SettingsPanel } from './SettingsBlock'
import { SharedDatabaseBlock } from './SharedDatabaseBlock'

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
  const rules = status?.verification.rules
  const batch = rules?.firstBatch ?? 50
  const wait = !rules || rules.holdHours === 1 ? 'an hour' : `${rules.holdHours} hours`
  const stopAt = `${+((rules?.maxBounceRate ?? 0.02) * 100).toFixed(1)}%`

  return (
    <div className="flex flex-col gap-4">
      <SettingsPanel>
        <SettingsBlock
          title="Unverifiable emails"
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
          <SettingsCheck
            checked={hideUnverifiable}
            disabled={!status || !verifiedOnly || save.isPending}
            onChange={(checked) => save.mutate(checked)}
            label="Hide people whose email can't be verified (recommended)"
            hint="On: they're left out of results, and search keeps looking to fill the page. Off: they're listed, marked Unverifiable where the email would be."
          />
          {save.isError && <Notice level="error">{(save.error as Error).message}</Notice>}
          {save.isSuccess && !save.isPending && <Notice level="success">Saved. Your next search uses it.</Notice>}
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
                campaign sends them in a first batch of {batch} and holds the rest for at least {wait}, until that batch's
                bounces are in. If more than {stopAt} of it bounces, the rest aren't sent until you choose to.
              </p>
              {!verifiedOnly && <p>Email verification is set to hand over unconfirmed guesses too, so these are always handed over.</p>}
            </>
          }
        >
          <SettingsCheck
            checked={allowFormatConfirmed}
            disabled={!status || !verifiedOnly || saveFormat.isPending}
            onChange={(checked) => saveFormat.mutate(checked)}
            label="Hand over addresses whose format is confirmed"
            hint="On: Reveal and saving give these addresses, and search shows people at those companies. Off: only verified addresses are handed over."
          />
          {saveFormat.isError && <Notice level="error">{(saveFormat.error as Error).message}</Notice>}
          {saveFormat.isSuccess && !saveFormat.isPending && <Notice level="success">Saved. Your next search uses it.</Notice>}
        </SettingsBlock>

        {status?.sharedDatabase && <SharedDatabaseBlock shared={status.sharedDatabase} />}
      </SettingsPanel>
    </div>
  )
}
