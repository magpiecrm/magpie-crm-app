import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Copy, Globe, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
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

const INPUT_CLASS =
  'w-full bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent'

type Domain = Awaited<ReturnType<typeof getSendingDomainsFn>>[number]

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="shrink-0 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
      aria-label="Copy"
      title="Copy"
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

function DomainCard({ d, onChanged }: { d: Domain; onChanged: () => void }) {
  const [open, setOpen] = useState(!d.ready)
  const check = useMutation({ mutationFn: () => checkSendingDomainFn({ data: { domain: d.domain } }), onSettled: onChanged })
  const remove = useMutation({ mutationFn: () => removeSendingDomainFn({ data: { domain: d.domain } }), onSettled: onChanged })

  return (
    <div className="border border-border rounded-md-s bg-muted/20">
      <div className="p-4 flex flex-wrap items-center gap-3">
        <Globe className="w-4 h-4 text-accent shrink-0" />
        <span className="text-sm font-semibold text-foreground">{d.domain}</span>
        {d.ready ? (
          <Badge variant="success">Ready to send</Badge>
        ) : (
          <Badge variant="warning">Waiting for DNS records</Badge>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide records' : 'DNS records'}
          </Button>
          <Button variant="outline" size="sm" isLoading={check.isPending} leftIcon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => check.mutate()}>
            Check now
          </Button>
          <button
            type="button"
            onClick={() => confirm(`Stop sending from ${d.domain}?`) && remove.mutate()}
            className="p-1.5 text-destructive hover:bg-destructive/10 rounded-md-s cursor-pointer"
            aria-label={`Remove ${d.domain}`}
            title="Remove"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {!d.ready && (
        <p className="px-4 -mt-1 pb-3 text-xs text-muted-foreground">
          {d.waitingFor ?? 'Add the records below at your domain provider. It usually takes a few minutes, sometimes up to a day.'}
          {check.data && !check.data.success && <span className="text-destructive"> {check.data.error}</span>}
        </p>
      )}
      {open && (
        <div className="border-t border-border">
          <ul className="divide-y divide-border/60">
            {d.records.map((r) => (
              <li key={r.name} className="px-4 py-3 flex flex-col gap-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">{r.type}</span>
                  <span className="text-muted-foreground">
                    {r.optional && <span className="font-semibold text-foreground">Recommended. </span>}
                    {r.purpose}
                  </span>
                </div>
                {(['name', 'value'] as const).map((part) => (
                  <div key={part} className="grid grid-cols-[3.5rem_1fr_auto] items-start gap-2">
                    <span className="text-muted-foreground pt-1">{part === 'name' ? 'Name' : 'Value'}</span>
                    <code className="font-mono text-foreground bg-background border border-border rounded px-2 py-1 break-all">{r[part]}</code>
                    <CopyButton value={r[part]} />
                  </div>
                ))}
              </li>
            ))}
          </ul>
          <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border/60">
            Some DNS providers add your domain to the name for you: if yours does, enter only the part before{' '}
            <code className="font-mono">.{d.domain}</code>. Already have a DMARC record? Keep yours.
          </p>
        </div>
      )}
    </div>
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
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
        <Send className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Sending is set up for you. There's nothing to connect: add the domain you send from, put its DNS records in
          place, and you're ready.
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">Sending domains</h4>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <RefreshCw className="w-4 h-4 animate-spin text-accent" /> Checking your domains…
          </div>
        ) : domains?.length ? (
          domains.map((d) => <DomainCard key={d.domain} d={d} onChanged={refresh} />)
        ) : (
          <p className="text-sm text-muted-foreground">No sending domains yet. Add the domain your emails come from, like acme.com.</p>
        )}
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (newDomain.trim()) add.mutate()
          }}
        >
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="acme.com"
            aria-label="Domain to send from"
            autoCapitalize="none"
            spellCheck={false}
            className={INPUT_CLASS}
          />
          <Button type="submit" isLoading={add.isPending} leftIcon={<Plus className="w-4 h-4" />} disabled={!newDomain.trim()}>
            Add domain
          </Button>
        </form>
        {add.data && !add.data.success && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" /> {add.data.error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Then add the addresses you send as (like <code className="font-mono">hello@acme.com</code>) in Sender addresses.
          Addresses on a subdomain, like <code className="font-mono">news.acme.com</code>, work too.
        </p>
      </div>

      {anyReady && (
        <div className="flex flex-col gap-3">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">Send a test</h4>
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (testTo.trim()) test.mutate()
            }}
          >
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
              aria-label="Send a test email to"
              className={INPUT_CLASS}
            />
            <Button type="submit" variant="secondary" isLoading={test.isPending} leftIcon={<Send className="w-4 h-4" />} disabled={!testTo.trim()}>
              Send test
            </Button>
          </form>
          {test.data && (
            <p className={`text-xs ${test.data.success ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>
              {test.data.success ? 'Sent. Check the inbox (and spam) for it.' : test.data.error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
