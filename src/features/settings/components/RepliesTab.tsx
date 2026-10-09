import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, RefreshCw } from 'lucide-react'
import { checkMailboxesNowFn, deleteMailboxFn, getSendersFn, mailboxesFn, saveMailboxFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { Select } from '../../../components/ui/Select'
import { SecretInput } from '../../../components/ui/SecretInput'
import { Switch } from '../../../components/ui/Switch'
import { queryKeys } from '../../../queryKeys'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel, SettingsRow } from './SettingsBlock'
import type { MailboxView } from '../../sequences/types'

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
    <div className="flex flex-col gap-4">
      <SettingsPanel>
        <SettingsBlock title="How it works">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Replies to sequence emails go to the sender's own inbox. Connect it here and every few minutes the app looks for new messages from the
            people its sequences have emailed: a reply stops that person's sequence and lets you know. Out-of-office replies don't, a "stop" or
            "unsubscribe" reply unsubscribes them, and bounce reports count as bounces.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Only who a message is from and which email it answers are read (and, for a reply, its first line, to spot "stop"). Nothing from your inbox
            is kept, and the app can't send or delete mail.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            While an inbox is connected, follow-ups wait until it's been checked in the last 15 minutes, so nobody gets one after replying.
          </p>
        </SettingsBlock>

        <SettingsBlock title="Inboxes" description="One for each sender address. Until a sender's inbox is connected, replies to it have to be marked by hand.">
          {isLoading ? (
            <SettingsEmpty>Loading…</SettingsEmpty>
          ) : senders.length === 0 ? (
            <SettingsEmpty>Add a sender address first (Settings → Sender addresses).</SettingsEmpty>
          ) : (
            <SettingsList>
              {senders.map((s) => (
                <SenderInbox key={s.id} sender={s} box={boxes.find((b) => b.sender_id === s.id) ?? null} />
              ))}
            </SettingsList>
          )}
          {boxes.length > 0 && (
            <>
              {check.error && <Notice level="error">{(check.error as Error).message}</Notice>}
              <SettingsActions>
                <Button variant="outline" leftIcon={<RefreshCw className="h-4 w-4" />} isLoading={check.isPending} onClick={() => check.mutate()}>
                  Check now
                </Button>
              </SettingsActions>
            </>
          )}
        </SettingsBlock>
      </SettingsPanel>
    </div>
  )
}

/** One sender's row in the list: its inbox's state, and under it the inbox's details or the form that connects it. */
function SenderInbox({ sender, box }: { sender: { id: number; name: string; email: string }; box: MailboxView | null }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.mailboxes() })
  const disconnect = useMutation({ mutationFn: () => deleteMailboxFn({ data: { id: box!.id } }), onSuccess: refresh })
  const [confirming, setConfirming] = useState(false)

  const state = !box
    ? null
    : box.status === 'ok'
      ? `checked ${ago(box.last_polled_at)}`
      : box.status === 'auth_failed'
        ? 'reconnect it'
        : `first failed ${ago(box.error_since)}`

  return (
    <SettingsRow
      icon={<Inbox className="h-4 w-4" />}
      title={sender.name || sender.email}
      // The address is the title when the sender has no name.
      detail={[sender.name ? sender.email : null, state].filter(Boolean).join(' · ') || undefined}
      badge={
        !box ? (
          <Badge>Not connected</Badge>
        ) : box.status === 'ok' ? (
          <Badge variant="success">Connected</Badge>
        ) : (
          <Badge variant="error">{box.status === 'auth_failed' ? 'Login refused' : 'Not working'}</Badge>
        )
      }
      actions={
        !box && !editing ? (
          <Button size="sm" onClick={() => setEditing(true)}>
            Connect inbox
          </Button>
        ) : undefined
      }
    >
      {box && !editing ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 text-sm">
            <p className="text-foreground">
              {box.user} on {box.host}
              {box.folder ? <span className="text-muted-foreground"> · reading {box.folder}</span> : null}
            </p>
            <p className="text-muted-foreground">{box.replies_found === 1 ? '1 reply found so far.' : `${box.replies_found} replies found so far.`}</p>
          </div>
          {box.last_error && (
            <Notice level="error" className="break-words">
              {box.last_error}
            </Notice>
          )}
          <SettingsActions>
            <Button size="sm" variant={box.status === 'ok' ? 'outline' : 'primary'} onClick={() => setEditing(true)}>
              {box.status === 'ok' ? 'Change' : 'Reconnect'}
            </Button>
            {confirming ? (
              <>
                <Button size="sm" variant="danger" isLoading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                  Disconnect
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            )}
          </SettingsActions>
        </div>
      ) : box || editing ? (
        <ConnectForm sender={sender} box={box} onDone={() => setEditing(false)} />
      ) : null}
    </SettingsRow>
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
      className="flex flex-col gap-3"
    >
      <FieldGrid>
        <Field label="Mail service">
          <Select value={service} onChange={(e) => setService(e.target.value)} className={INPUT_CLASS}>
            {SERVICES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      </FieldGrid>

      {service === 'microsoft' ? (
        <Notice>
          Microsoft 365 and Outlook don't allow password logins to an inbox from other apps, so they can't be connected this way yet. Mark replies by
          hand on the sequence's People tab for now.
        </Notice>
      ) : (
        <>
          {service === 'gmail' && (
            <Notice title="Gmail needs an app password, not your normal one:">
              <ol className="list-decimal pl-4">
                <li>Turn on 2-Step Verification in your Google Account (Security), if it isn't on.</li>
                <li>
                  Go to <code className="font-mono">myaccount.google.com/apppasswords</code>, make one called "MagpieCRM", and paste the 16 letters below.
                </li>
                <li>Google Workspace: if there's no App passwords page, your admin has turned them off for your organisation.</li>
              </ol>
            </Notice>
          )}
          {custom && (
            <>
              <FieldGrid cols={3}>
                <Field label="IMAP server" className="sm:col-span-2">
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" className={INPUT_CLASS} />
                </Field>
                <Field label="Port">
                  <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 993)} className={INPUT_CLASS} />
                </Field>
              </FieldGrid>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={secure} onChange={setSecure} label="SSL/TLS" />
                <span>SSL/TLS (port 993). Off: STARTTLS (port 143).</span>
              </div>
            </>
          )}
          <FieldGrid>
            <Field label="Login">
              <input value={user} onChange={(e) => setUser(e.target.value)} className={INPUT_CLASS} autoComplete="off" />
            </Field>
            <Field label={service === 'gmail' ? 'App password' : 'Password'}>
              <SecretInput id={`pass-${sender.id}`} value={password} onChange={setPassword} placeholder={box ? 'Leave empty to keep the saved one' : ''} />
            </Field>
          </FieldGrid>
          {save.error && <Notice level="error">{(save.error as Error).message}</Notice>}
          <SettingsActions>
            <Button type="submit" size="sm" isLoading={save.isPending} disabled={!user || (!password && !box) || (custom && !host)}>
              Check and connect
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onDone}>
              Cancel
            </Button>
          </SettingsActions>
        </>
      )}
    </form>
  )
}
