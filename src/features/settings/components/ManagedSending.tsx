import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronUp, Copy, Globe, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import {
  addSendingDomainFn,
  checkSendingDomainFn,
  getSendingDomainsFn,
  getSendingHealthFn,
  removeSendingDomainFn,
  sendProviderTestEmailFn,
} from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { SettingsBlock, SettingsEmpty, SettingsInline, SettingsList, SettingsPanel, SettingsRow } from './SettingsBlock'
import { SendingHealth } from './SendingHealth'

type Domain = Awaited<ReturnType<typeof getSendingDomainsFn>>[number]
type Health = Awaited<ReturnType<typeof getSendingHealthFn>>

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
function ago(iso: string | null) {
  if (!iso) return null
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

/** A domain's line under its name: when it was last checked, and what's gone out from it and how it was received, from the Reputation figures. */
function summary(d: Domain, health: Health | undefined) {
  const own = health?.domains.filter((r) => r.domain === d.domain || r.domain.endsWith(`.${d.domain}`)) ?? []
  const sent = own.reduce((n, r) => n + r.stats.sent, 0)
  const score = own.find((r) => r.domain === d.domain)?.score ?? null
  return [
    ago(d.checkedAt) && `Checked ${ago(d.checkedAt)}`,
    health && `${sent.toLocaleString()} sent in ${health.windowDays} days`,
    score !== null && `reputation ${score}%`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** A DNS name or value that wraps only after a dot or semicolon, never inside a label, so what's read matches what's pasted. */
function Breakable({ value }: { value: string }) {
  return (
    <>
      {value.split(/(?<=[.;])/).map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </>
  )
}

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

function DomainRow({ d, health, onChanged }: { d: Domain; health: Health | undefined; onChanged: () => void }) {
  const [open, setOpen] = useState(!d.ready)
  const check = useMutation({ mutationFn: () => checkSendingDomainFn({ data: { domain: d.domain } }), onSettled: onChanged })
  const remove = useMutation({ mutationFn: () => removeSendingDomainFn({ data: { domain: d.domain } }), onSettled: onChanged })

  return (
    <SettingsRow
      icon={<Globe className="h-4 w-4" />}
      title={d.domain}
      detail={summary(d, health) || undefined}
      badge={d.ready ? <Badge variant="success" status>Ready to send</Badge> : <Badge variant="warning" status>Waiting for DNS</Badge>}
      // One line per domain: Check now only while it's waiting, and the records behind the chevron.
      actions={
        <>
          {!d.ready && (
            <Button variant="outline" size="sm" isLoading={check.isPending} leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => check.mutate()}>
              Check now
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={open}
            aria-label={open ? `Hide ${d.domain}'s DNS records` : `Show ${d.domain}'s DNS records`}
            title={open ? 'Hide DNS records' : 'Show DNS records'}
            leftIcon={open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            onClick={() => setOpen((o) => !o)}
          />
        </>
      }
    >
      {open && (
        <div className="flex flex-col gap-3">
          {!d.ready && (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {d.waitingFor ?? 'Add the records below at your domain provider. It usually takes a few minutes, sometimes up to a day.'}
            </p>
          )}
          {!d.ready && check.data && !check.data.success && <Notice level="error">{check.data.error}</Notice>}
          {/* One flat list of records: type and what it's for, then each part on one line with its copy button. */}
          <div className="divide-y divide-border/70">
            {d.records.map((r) => (
              <div key={r.name} className="flex flex-col gap-1.5 py-2.5">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="font-mono font-semibold text-foreground">{r.type}</span>
                  {r.purpose && <span className="text-muted-foreground">{r.purpose}</span>}
                  {r.optional && <Badge>Recommended</Badge>}
                </p>
                {/* Label beside the value where the panel is wide; above it on a phone, so a hostname has the whole width. */}
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 @[36rem]:grid-cols-[3rem_minmax(0,1fr)_auto]">
                  {(['name', 'value'] as const).map((part) => (
                    <div key={part} className="contents">
                      <dt className="col-span-2 pt-1 text-[13px] text-muted-foreground @[36rem]:col-span-1 @[36rem]:pt-0">{part === 'name' ? 'Name' : 'Value'}</dt>
                      <dd className="min-w-0 rounded-md-xs bg-muted/60 px-2 py-1 font-mono text-xs text-foreground">
                        <Breakable value={r[part]} />
                      </dd>
                      <CopyButton value={r[part]} />
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Some DNS providers add your domain to the name for you: if yours does, enter only the part before{' '}
            <code className="font-mono">.{d.domain}</code>. Already have a DMARC record? Keep yours.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {d.ready && (
              <Button variant="outline" size="sm" isLoading={check.isPending} leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => check.mutate()}>
                Check now
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => confirm(`Stop sending from ${d.domain}?`) && remove.mutate()}
              isLoading={remove.isPending}
              leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              className="!text-destructive hover:!bg-destructive/10"
            >
              Remove domain
            </Button>
          </div>
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
  const { data: health } = useQuery({ queryKey: queryKeys.settings.sendingHealth(), queryFn: () => getSendingHealthFn() })
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
      {/* Only until there's a domain: after that the list says where things stand. */}
      {domains && domains.length === 0 && (
        <Notice>
          Sending is set up for you. There's nothing to connect: add the domain you send from, put its DNS records in place, and you're ready.
        </Notice>
      )}

      <SettingsPanel>
        <SettingsBlock
          title="Sending domains"
          description={<p>The domains your campaigns come from. Each one sends once its DNS records are in place; Check now looks again straight away.</p>}
        >
          {isLoading ? (
            <SettingsEmpty>
              <RefreshCw className="mr-2 inline h-4 w-4 animate-spin text-accent" />
              Checking your domains…
            </SettingsEmpty>
          ) : domains?.length ? (
            <SettingsList>
              {/* Ones still waiting first: they're what there is to do. */}
              {[...domains].sort((a, b) => Number(a.ready) - Number(b.ready)).map((d) => (
                <DomainRow key={d.domain} d={d} health={health} onChanged={refresh} />
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
              Then add the addresses you send as (like <code className="font-mono">hello@acme.com</code>) in Mailboxes. Addresses on a
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
            <SettingsInline>
              <Field label="Domain to send from" error={add.data && !add.data.success ? add.data.error : undefined}>
                <input
                  required
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="acme.com"
                  autoCapitalize="none"
                  spellCheck={false}
                  className={INPUT_CLASS}
                />
              </Field>
              <Button type="submit" isLoading={add.isPending} leftIcon={<Plus className="h-4 w-4" />}>
                Add domain
              </Button>
            </SettingsInline>
          </form>
        </SettingsBlock>

        <SendingHealth />

        {anyReady && (
          <SettingsBlock title="Send a test" description="Sends one email, so you can check it arrives and how it looks.">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (testTo.trim()) test.mutate()
              }}
            >
              <SettingsInline>
                <Field label="Send a test email to">
                  <input type="email" required value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" className={INPUT_CLASS} />
                </Field>
                <Button type="submit" variant="outline" isLoading={test.isPending} leftIcon={<Send className="h-4 w-4" />}>
                  Send a test
                </Button>
              </SettingsInline>
              {test.data && (
                <Notice level={test.data.success ? 'success' : 'error'}>
                  {test.data.success ? 'Sent. Check the inbox (and spam) for it.' : test.data.error}
                </Notice>
              )}
            </form>
          </SettingsBlock>
        )}
      </SettingsPanel>
    </div>
  )
}
