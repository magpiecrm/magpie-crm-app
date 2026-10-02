import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, Inbox, RefreshCw } from 'lucide-react'
import { checkMailboxesNowFn, deleteMailboxFn, getSendersFn, mailboxesFn, saveMailboxFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Select } from '../../../components/ui/Select'
import { SecretInput } from '../../../components/ui/SecretInput'
import { Switch } from '../../../components/ui/Switch'
import { queryKeys } from '../../../queryKeys'
import { SettingsBlock } from './SettingsBlock'
import type { MailboxView } from '../../sequences/types'

const FIELD = 'w-full bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent'

/** Mail services people use, with their IMAP server. */
const SERVICES = [
  { id: 'gmail', label: 'Gmail or Google Workspace', host: 'imap.gmail.com', port: 993, secure: true },
  { id: 'microsoft', label: 'Microsoft 365 or Outlook', host: 'outlook.office365.com', port: 993, secure: true },
  { id: 'zoho', label: 'Zoho Mail', host: 'imap.zoho.com', port: 993, secure: true },
  { id: 'fastmail', label: 'Fastmail', host: 'imap.fastmail.com', port: 993, secure: true },
  { id: 'icloud', label: 'iCloud Mail', host: 'imap.mail.me.com', port: 993, secure: true },
  { id: 'other', label: 'Another mail service (IMAP)', host: '', port: 993, secure: true },
] as const

const serviceFor = (host: string) => SERVICES.find((s) => s.host && s.host === host)?.id ?? 'other'

function ago(iso: string | null): string {
  if (!iso) return 'not yet'
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Settings → Reply detection: each sender's inbox, connected over IMAP so replies stop sequences. */
export function RepliesTab() {
  const queryClient = useQueryClient()
  const { data: senders = [], isLoading } = useQuery({ queryKey: queryKeys.email.senders(), queryFn: () => getSendersFn(), select: (r) => r.senders as Array<{ id: number; name: string; email: string }> })
  const { data: boxes = [] } = useQuery({ queryKey: queryKeys.sequences.mailboxes(), queryFn: () => mailboxesFn(), refetchInterval: 60_000 })
  const check = useMutation({
    mutationFn: () => checkMailboxesNowFn(),
    onSuccess: (list) => queryClient.setQueryData(queryKeys.sequences.mailboxes(), list),
  })

  return (
    <div className="space-y-6">
      <SettingsBlock
        title="How it works"
        description={
          <>
            <p>
              Replies to sequence emails go to the sender's own inbox. Connect it here and every few minutes the app looks for new messages from the
              people its sequences have emailed: a reply stops that person's sequence and lets you know. Out-of-office replies don't, a "stop" or
              "unsubscribe" reply unsubscribes them, and bounce reports count as bounces.
            </p>
            <p>
              Only who a message is from and which email it answers are read (and, for a reply, its first line, to spot "stop"). Nothing from your inbox
              is kept, and the app can't send or delete mail.
            </p>
            <p>While an inbox is connected, follow-ups wait until it's been checked in the last 15 minutes, so nobody gets one after replying.</p>
          </>
        }
      >
        {boxes.length > 0 && (
          <div className="flex items-center gap-3">
            <Button size="sm" variant="secondary" leftIcon={<RefreshCw className="w-3.5 h-3.5" />} isLoading={check.isPending} onClick={() => check.mutate()}>
              Check now
            </Button>
            {check.error && <span className="text-xs text-destructive">{(check.error as Error).message}</span>}
          </div>
        )}
      </SettingsBlock>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : senders.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add a sender address first (Settings → Sender addresses).</p>
      ) : (
        senders.map((s) => <SenderInbox key={s.id} sender={s} box={boxes.find((b) => b.sender_id === s.id) ?? null} />)
      )}
    </div>
  )
}

function SenderInbox({ sender, box }: { sender: { id: number; name: string; email: string }; box: MailboxView | null }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.mailboxes() })
  const disconnect = useMutation({ mutationFn: () => deleteMailboxFn({ data: { id: box!.id } }), onSuccess: refresh })
  const [confirming, setConfirming] = useState(false)

  return (
    <SettingsBlock
      title={sender.name || sender.email}
      description={
        <>
          <p>{sender.email}</p>
          {box ? (
            box.status === 'ok' ? (
              <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> Connected · checked {ago(box.last_polled_at)}
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-destructive">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {box.status === 'auth_failed' ? 'Login refused: reconnect it.' : `Not working (first failed ${ago(box.error_since)})`}
              </p>
            )
          ) : (
            <p>Not connected: replies to this sender have to be marked by hand.</p>
          )}
        </>
      }
    >
      {box && !editing ? (
        <div className="space-y-2 text-sm">
          <p className="text-foreground">
            <Inbox className="inline w-4 h-4 mr-1.5 -mt-0.5 text-muted-foreground" />
            {box.user} on {box.host}
            {box.folder ? <span className="text-muted-foreground"> · reading {box.folder}</span> : null}
          </p>
          <p className="text-muted-foreground">{box.replies_found === 1 ? '1 reply found so far.' : `${box.replies_found} replies found so far.`}</p>
          {box.last_error && <p className="text-destructive">{box.last_error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {box.status === 'ok' ? 'Change' : 'Reconnect'}
            </Button>
            {confirming ? (
              <>
                <Button size="sm" variant="danger" isLoading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                  Disconnect
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            )}
          </div>
        </div>
      ) : box || editing ? (
        <ConnectForm sender={sender} box={box} onDone={() => setEditing(false)} />
      ) : (
        <div>
          <Button size="sm" onClick={() => setEditing(true)}>
            Connect inbox
          </Button>
        </div>
      )}
    </SettingsBlock>
  )
}

function ConnectForm({ sender, box, onDone }: { sender: { id: number; email: string }; box: MailboxView | null; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [service, setService] = useState<string>(box ? serviceFor(box.host) : 'gmail')
  const preset = SERVICES.find((s) => s.id === service)!
  const [host, setHost] = useState(box?.host ?? '')
  const [port, setPort] = useState(box?.port ?? 993)
  const [secure, setSecure] = useState(box?.secure ?? true)
  const [user, setUser] = useState(box?.user ?? sender.email)
  const [password, setPassword] = useState('')
  const custom = service === 'other'
  const save = useMutation({
    mutationFn: () =>
      saveMailboxFn({
        data: {
          senderId: sender.id,
          host: custom ? host : preset.host,
          port: custom ? port : preset.port,
          secure: custom ? secure : preset.secure,
          user,
          password: password || undefined,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.mailboxes() })
      onDone()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
      className="space-y-3 max-w-lg"
    >
      <div>
        <label htmlFor={`svc-${sender.id}`} className="block text-xs font-medium text-foreground mb-1">
          Mail service
        </label>
        <Select id={`svc-${sender.id}`} value={service} onChange={(e) => setService(e.target.value)} className={FIELD}>
          {SERVICES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>

      {service === 'microsoft' ? (
        <p className="text-sm text-muted-foreground">
          Microsoft 365 and Outlook don't allow password logins to an inbox from other apps, so they can't be connected this way yet. Mark replies
          by hand on the sequence's People tab for now.
        </p>
      ) : (
        <>
          {service === 'gmail' && (
            <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Gmail needs an app password, not your normal one:</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Turn on 2-Step Verification in your Google Account (Security), if it isn't on.</li>
                <li>
                  Go to <span className="font-mono">myaccount.google.com/apppasswords</span>, make one called "MagpieCRM", and paste the 16 letters below.
                </li>
                <li>Google Workspace: if there's no App passwords page, your admin has turned them off for your organisation.</li>
              </ol>
            </div>
          )}
          {custom && (
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <div>
                <label htmlFor={`host-${sender.id}`} className="block text-xs font-medium text-foreground mb-1">
                  IMAP server
                </label>
                <input id={`host-${sender.id}`} value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" className={FIELD} />
              </div>
              <div>
                <label htmlFor={`port-${sender.id}`} className="block text-xs font-medium text-foreground mb-1">
                  Port
                </label>
                <input id={`port-${sender.id}`} type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 993)} className={FIELD} />
              </div>
              <div className="col-span-2 flex items-center gap-2 text-sm">
                <Switch checked={secure} onChange={setSecure} label="SSL/TLS" />
                <span className="text-muted-foreground">SSL/TLS (port 993). Off: STARTTLS (port 143).</span>
              </div>
            </div>
          )}
          <div>
            <label htmlFor={`user-${sender.id}`} className="block text-xs font-medium text-foreground mb-1">
              Login
            </label>
            <input id={`user-${sender.id}`} value={user} onChange={(e) => setUser(e.target.value)} className={FIELD} autoComplete="off" />
          </div>
          <div>
            <label htmlFor={`pass-${sender.id}`} className="block text-xs font-medium text-foreground mb-1">
              {service === 'gmail' ? 'App password' : 'Password'}
            </label>
            <SecretInput id={`pass-${sender.id}`} value={password} onChange={setPassword} placeholder={box ? 'Leave empty to keep the saved one' : ''} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" isLoading={save.isPending} disabled={!user || (!password && !box) || (custom && !host)}>
              Check and connect
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            {save.error && <span className="text-xs text-destructive">{(save.error as Error).message}</span>}
          </div>
        </>
      )}
    </form>
  )
}
