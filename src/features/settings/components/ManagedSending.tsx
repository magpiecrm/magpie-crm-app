import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronUp, Copy, Globe, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import {
  addSendingDomainFn,
  checkSendingDomainFn,
  getSendingDomainsFn,
  removeSendingDomainFn,
  sendProviderTestEmailFn,
} from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel, SettingsRow } from './SettingsBlock'
import { SendingHealth } from './SendingHealth'

type Domain = Awaited<ReturnType<typeof getSendingDomainsFn>>[number]

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      aria-label="Copy"
      title="Copy"
      leftIcon={copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
    />
  )
}

function DomainRow({ d, onChanged }: { d: Domain; onChanged: () => void }) {
  const [open, setOpen] = useState(!d.ready)
  const check = useMutation({ mutationFn: () => checkSendingDomainFn({ data: { domain: d.domain } }), onSettled: onChanged })
  const remove = useMutation({ mutationFn: () => removeSendingDomainFn({ data: { domain: d.domain } }), onSettled: onChanged })

  return (
    <SettingsRow
      icon={<Globe className="h-4 w-4" />}
      title={d.domain}
      badge={d.ready ? <Badge variant="success">Ready to send</Badge> : <Badge variant="warning">Waiting for DNS records</Badge>}
      actions={
        // Three actions leave no room for the domain on a phone, so the two
        // with words keep only their icons there.
        <>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-label={open ? 'Hide DNS records' : 'DNS records'}
            leftIcon={open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="hidden sm:inline">{open ? 'Hide records' : 'DNS records'}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Check now"
            isLoading={check.isPending}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => check.mutate()}
          >
            <span className="hidden sm:inline">Check now</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => confirm(`Stop sending from ${d.domain}?`) && remove.mutate()}
            aria-label={`Remove ${d.domain}`}
            title="Remove"
            className="hover:!bg-destructive/10 hover:!text-destructive"
            leftIcon={<Trash2 className="h-4 w-4" />}
          />
        </>
      }
    >
      {(!d.ready || open) && (
        <div className="flex flex-col gap-3">
          {!d.ready && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {d.waitingFor ?? 'Add the records below at your domain provider. It usually takes a few minutes, sometimes up to a day.'}
            </p>
          )}
          {!d.ready && check.data && !check.data.success && <Notice level="error">{check.data.error}</Notice>}
          {open && (
            <>
              <SettingsList>
                {d.records.map((r) => (
                  <SettingsRow
                    key={r.name}
                    title={<span className="font-mono">{r.type}</span>}
                    badge={r.optional ? <Badge>Recommended</Badge> : undefined}
                  >
                    <div className="flex flex-col gap-2">
                      {r.purpose && <p className="text-xs leading-relaxed text-muted-foreground">{r.purpose}</p>}
                      {(['name', 'value'] as const).map((part) => (
                        <div key={part} className="flex flex-col gap-1.5">
                          <span className="text-xs font-semibold text-muted-foreground">{part === 'name' ? 'Name' : 'Value'}</span>
                          <div className="flex items-start gap-2">
                            <code className="min-w-0 flex-1 rounded-md-s border border-border bg-background px-3 py-2 text-xs text-foreground break-all">
                              {r[part]}
                            </code>
                            <CopyButton value={r[part]} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </SettingsRow>
                ))}
              </SettingsList>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Some DNS providers add your domain to the name for you: if yours does, enter only the part before{' '}
                <code className="font-mono">.{d.domain}</code>. Already have a DMARC record? Keep yours.
              </p>
            </>
          )}
        </div>
      )}
    </SettingsRow>
  )
}

/**
 * Settings → Sending when the host runs sending (SENDING_MANAGED): no
 * provider or credentials, just the domains you send from and the DNS
 * records that verify them.
 */
export function ManagedSending() {
  const queryClient = useQueryClient()
  const { data: domains, isLoading } = useQuery({ queryKey: queryKeys.settings.sendingDomains(), queryFn: () => getSendingDomainsFn() })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.sendingDomains() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() })
  }
  const [newDomain, setNewDomain] = useState('')
  const add = useMutation({
    mutationFn: () => addSendingDomainFn({ data: { domain: newDomain } }),
    onSuccess: (res) => {
      if (res.success) setNewDomain('')
      refresh()
    },
  })
  const [testTo, setTestTo] = useState('')
  const test = useMutation({ mutationFn: () => sendProviderTestEmailFn({ data: { to: testTo } }) })
  const anyReady = domains?.some((d) => d.ready)

  return (
    <div className="flex flex-col gap-4">
      <Notice>
        Sending is set up for you. There's nothing to connect: add the domain you send from, put its DNS records in place, and you're ready.
      </Notice>

      <SettingsPanel>
        <SettingsBlock title="Sending domains">
          {isLoading ? (
            <SettingsEmpty>
              <RefreshCw className="mr-2 inline h-4 w-4 animate-spin text-accent" />
              Checking your domains…
            </SettingsEmpty>
          ) : domains?.length ? (
            <SettingsList>
              {domains.map((d) => (
                <DomainRow key={d.domain} d={d} onChanged={refresh} />
              ))}
            </SettingsList>
          ) : (
            <SettingsEmpty>No sending domains yet. Add the domain your emails come from, like acme.com.</SettingsEmpty>
          )}
        </SettingsBlock>

        <SettingsBlock
          title="Add a domain"
          description={
            <p>
              Then add the addresses you send as (like <code className="font-mono">hello@acme.com</code>) in Sender addresses. Addresses on a
              subdomain, like <code className="font-mono">news.acme.com</code>, work too.
            </p>
          }
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (newDomain.trim()) add.mutate()
            }}
          >
            <FieldGrid>
              <Field label="Domain to send from" error={add.data && !add.data.success ? add.data.error : undefined}>
                <input
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="acme.com"
                  autoCapitalize="none"
                  spellCheck={false}
                  className={INPUT_CLASS}
                />
              </Field>
            </FieldGrid>
            <SettingsActions>
              <Button type="submit" isLoading={add.isPending} leftIcon={<Plus className="h-4 w-4" />} disabled={!newDomain.trim()}>
                Add domain
              </Button>
            </SettingsActions>
          </form>
        </SettingsBlock>

        <SendingHealth />

        {anyReady && (
          <SettingsBlock title="Send a test">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (testTo.trim()) test.mutate()
              }}
            >
              <FieldGrid>
                <Field label="Send a test email to">
                  <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" className={INPUT_CLASS} />
                </Field>
              </FieldGrid>
              {test.data && (
                <Notice level={test.data.success ? 'success' : 'error'}>
                  {test.data.success ? 'Sent. Check the inbox (and spam) for it.' : test.data.error}
                </Notice>
              )}
              <SettingsActions>
                <Button type="submit" isLoading={test.isPending} leftIcon={<Send className="h-4 w-4" />} disabled={!testTo.trim()}>
                  Send a test
                </Button>
              </SettingsActions>
            </form>
          </SettingsBlock>
        )}
      </SettingsPanel>
    </div>
  )
}
