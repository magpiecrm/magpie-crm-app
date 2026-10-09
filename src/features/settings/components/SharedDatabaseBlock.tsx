import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../../components/ui/Button'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { setSharedDatabaseFn } from '../../../server/functions'
import { SettingsActions, SettingsBlock, SettingsCheck } from './SettingsBlock'

/**
 * Settings → Prospect search, in a hosted copy whose host runs a shared
 * database of business contacts: joining it (agreeing to the host's
 * Contributor Terms) or leaving.
 */
export function SharedDatabaseBlock({ shared }: { shared: { contributing: boolean; termsUrl: string | null } }) {
  const queryClient = useQueryClient()
  const [agreed, setAgreed] = useState(false)
  const change = useMutation({
    mutationFn: async (contribute: boolean) => {
      const res = await setSharedDatabaseFn({ data: { contribute } })
      if (!res.success) throw new Error(res.error)
      return res.contributing
    },
    onSuccess: () => {
      setAgreed(false)
      return queryClient.invalidateQueries({ queryKey: queryKeys.prospects.status() })
    },
  })
  const terms = shared.termsUrl ? (
    <a href={shared.termsUrl} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
      Contributor Terms
    </a>
  ) : (
    'Contributor Terms'
  )

  return (
    <SettingsBlock
      title="Shared database"
      description={
        <>
          <p>
            Your host keeps a shared database of business contacts. Workspaces that contribute send it the people they save
            from prospect search with a verified email, so nobody pays to find the same person twice.
          </p>
          <p>
            What's sent is the person's name, job title, employer, country, profile address and verified work email. Never
            contacts you imported or who signed up, your lists or notes, or anything about what you send.
          </p>
          <p>
            Your host tells each person it holds their details, and takes their opt-outs. Someone who opts out there is
            removed from your contacts too, as with any opt-out.
          </p>
        </>
      }
    >
      {shared.contributing ? (
        <>
          <Notice level="success">This workspace contributes the verified contacts it saves from prospect search.</Notice>
          <SettingsActions>
            <Button variant="secondary" onClick={() => change.mutate(false)} isLoading={change.isPending}>
              Stop contributing
            </Button>
          </SettingsActions>
          <p className="text-xs leading-relaxed text-muted-foreground">Stopping sends nothing new. What's already there stays.</p>
        </>
      ) : (
        <>
          <SettingsCheck
            checked={agreed}
            disabled={change.isPending}
            onChange={setAgreed}
            label={<>I agree to the {terms}</>}
            hint="They say you found these people lawfully, through prospect search here, and not by collecting their consent for something else."
          />
          <SettingsActions>
            <Button onClick={() => change.mutate(true)} disabled={!agreed} isLoading={change.isPending}>
              Start contributing
            </Button>
          </SettingsActions>
        </>
      )}
      {change.isError && <Notice level="error">{(change.error as Error).message}</Notice>}
    </SettingsBlock>
  )
}
