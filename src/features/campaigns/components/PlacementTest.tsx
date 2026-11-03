import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { placementTestFn, startPlacementTestFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'

/** The warmup pool's seed inboxes, by their mail provider (its own ids). */
const PROVIDERS: Record<string, string> = {
  gmail: 'Gmail',
  google_workspace: 'Google Workspace',
  outlook: 'Outlook.com',
  microsoft365: 'Microsoft 365',
  yahoo: 'Yahoo',
  aol: 'AOL',
  icloud: 'iCloud',
  zoho: 'Zoho',
  fastmail: 'Fastmail',
  proton: 'Proton',
  gmx: 'GMX',
  other: 'Other',
}

/**
 * A placement test for the email being written: it goes from the sender to
 * the warmup pool's seed inboxes through the same mail server as a campaign,
 * and where each copy landed comes back over the next few minutes.
 */
export function PlacementTest({ sender, subject, htmlContent, previewText }: { sender: { name: string; email: string }; subject: string; htmlContent: string; previewText?: string }) {
  const [testId, setTestId] = useState<string | null>(null)
  const start = useMutation({
    mutationFn: () => startPlacementTestFn({ data: { sender, subject: subject || 'No subject', htmlContent, previewText } }),
    onSuccess: (r) => setTestId(r.id),
  })
  const result = useQuery({
    queryKey: queryKeys.settings.placementTest(testId ?? ''),
    queryFn: () => placementTestFn({ data: { id: testId! } }),
    enabled: Boolean(testId),
    refetchInterval: (q) => (!q.state.data || q.state.data.families.some((f) => f.waiting > 0) ? 15_000 : false),
  })
  const families = result.data?.families ?? []
  const total = (k: 'inbox' | 'tabs' | 'spam' | 'missing' | 'waiting') => families.reduce((n, f) => n + f[k], 0)
  const waiting = total('waiting')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="text-base font-bold text-foreground">Where will it land?</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Sends this email from {sender.email} to about 20 test inboxes at Gmail, Outlook, Yahoo and others, the same way a campaign goes, then shows
          where each landed: the inbox, a tab like Promotions, or spam. Merge tags are filled with stand-in details. Each test counts towards your
          month's few, so run one once the email is ready.
        </p>
      </div>
      {start.error && <Notice level="error">{(start.error as Error).message}</Notice>}
      {!testId ? (
        <Button leftIcon={<Inbox className="h-4 w-4" />} isLoading={start.isPending} disabled={!htmlContent.trim()} title={htmlContent.trim() ? undefined : 'Write the email first.'} onClick={() => start.mutate()}>
          Run placement test
        </Button>
      ) : result.error ? (
        <Notice level="error">{(result.error as Error).message}</Notice>
      ) : !result.data ? (
        <p className="text-xs text-muted-foreground">Sent. Waiting for the first answers…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground tabular-nums">
            {total('inbox')} inbox · {total('tabs')} tabs · {total('spam')} spam
            {total('missing') > 0 && ` · ${total('missing')} never arrived`}
            {waiting > 0 && <span className="text-muted-foreground"> · {waiting} still to come</span>}
          </p>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">Provider</th>
                <th className="py-1 text-right font-medium">Inbox</th>
                <th className="py-1 text-right font-medium">Tabs</th>
                <th className="py-1 text-right font-medium">Spam</th>
                <th className="py-1 text-right font-medium">Missing</th>
              </tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.family} className="border-t border-border">
                  <td className="py-1.5 text-foreground">{PROVIDERS[f.family] ?? f.family}</td>
                  <td className="py-1.5 text-right">{f.inbox}</td>
                  <td className="py-1.5 text-right">{f.tabs}</td>
                  <td className={`py-1.5 text-right ${f.spam ? 'text-destructive' : ''}`}>{f.spam}</td>
                  <td className="py-1.5 text-right text-muted-foreground">{f.waiting ? `${f.missing} (+${f.waiting} to come)` : f.missing}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {waiting === 0 && total('spam') > 0 && (
            <Notice level="warning">
              Some copies went to spam. Spam filters weigh the sender's reputation most, then the email: fewer links and images, no attachments, and a
              plain, personal subject help.
            </Notice>
          )}
        </div>
      )}
    </div>
  )
}
