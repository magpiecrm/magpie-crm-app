import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox, RefreshCw } from 'lucide-react'
import { checkMailboxesNowFn, deleteMailboxFn, mailboxesFn, recheckMailboxSendingFn, saveMailboxFn, setMailboxSendingFn, warmupStandingFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { Select } from '../../../components/ui/Select'
import { SecretInput } from '../../../components/ui/SecretInput'
import { Switch } from '../../../components/ui/Switch'
import { queryKeys } from '../../../queryKeys'
import { SettingsActions, SettingsMore, SettingsRow } from './SettingsBlock'
import type { MailboxView } from '../../sequences/types'

/** Mail services people use, with their IMAP server (their sending server goes with it: mailboxes/send.ts smtpServerFor). */
const SERVICES = [
  { id: 'gmail', label: 'Gmail or Google Workspace', host: 'imap.gmail.com', port: 993, secure: true },
  { id: 'microsoft', label: 'Microsoft 365 or Outlook', host: 'outlook.office365.com', port: 993, secure: true },
  { id: 'zoho', label: 'Zoho Mail', host: 'imap.zoho.com', port: 993, secure: true },
  { id: 'fastmail', label: 'Fastmail', host: 'imap.fastmail.com', port: 993, secure: true },
  { id: 'icloud', label: 'iCloud Mail', host: 'imap.mail.me.com', port: 993, secure: true },
  { id: 'other', label: 'Another mail service (IMAP)', host: '', port: 993, secure: true },
] as const

/** Zoho has a server for each region and kind of account; the app finds the right one when it connects. */
const isZoho = (host: string) => /(^|\.)(zoho\.[a-z.]+|zohocloud\.ca)$/i.test(host)

const serviceFor = (host: string) => (isZoho(host) ? 'zoho' : (SERVICES.find((s) => s.host && s.host === host)?.id ?? 'other'))

function ago(iso: string | null): string {
  if (!iso) return 'not yet'
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Under the Mailboxes list: check every connected inbox now, and how reply detection works. */
export function InboxFooter() {
  const queryClient = useQueryClient()
  const { data: boxes = [] } = useQuery({ queryKey: queryKeys.sequences.mailboxes(), queryFn: () => mailboxesFn(), refetchInterval: 60_000 })
  const check = useMutation({
    mutationFn: () => checkMailboxesNowFn(),
    onSuccess: (list) => queryClient.setQueryData(queryKeys.sequences.mailboxes(), list),
  })
  const { data: warmup } = useQuery({ queryKey: queryKeys.settings.warmupStanding(), queryFn: () => warmupStandingFn(), staleTime: 60_000 })

  return (
    <>
      {boxes.length > 0 && (
        <>
          {check.error && <Notice level="error">{(check.error as Error).message}</Notice>}
          <SettingsActions>
            <Button variant="outline" size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} isLoading={check.isPending} onClick={() => check.mutate()}>
              Check inboxes now
            </Button>
          </SettingsActions>
        </>
      )}
    <SettingsMore summary="How connected inboxes work">
      <p>
        Replies to sequence emails go to the sender's own inbox. Connect it here and every few minutes the app looks for new messages from the
        people its sequences have emailed: a reply stops that person's sequence and lets you know. Out-of-office replies don't, a "stop" or
        "unsubscribe" reply unsubscribes them, and bounce reports count as bounces.
      </p>
      <p>
        Connecting an inbox also checks it can send, with one email from it to itself. Once it can, the sender's sequence emails go out through
        their own mailbox rather than the workspace's mail server: email from a person's own mailbox reaches the inbox more often. Each mailbox
        sends at most its daily number, a few minutes apart, with no open or click tracking, and its emails ask for a reply of "stop" rather than
        linking to an unsubscribe page. Campaigns always go through the workspace's mail server.
      </p>
      <p>
        You can read each reply and answer it in Sell → Inbox (or on the sequence's Replies tab). For that, the text of replies to sequence emails is
        kept here (not their attachments), along with answers to them sent from your inbox, and replies found before this was kept are looked up
        once. An answer sent from here goes out from the sender address, through the mailbox where its sequence emails do, and is in the inbox's Sent
        folder.
      </p>
      <p>
        Of anything else in your inbox, only who a message is from and which email it answers are read, and none of it is kept. Apart from adding
        copies of what it sends to Sent (where the mail service doesn't itself), the app never changes or deletes anything in your inbox.
        {warmup?.offered &&
          " A sender you warm up (Settings → Warmup) is the exception: its login also goes to the warmup pool, which files away and deletes the warmup mail in its inbox."}
      </p>
      <p>
        While an inbox is connected, follow-ups wait until it's been checked in the last 15 minutes, so nobody gets one after replying.
      </p>
    </SettingsMore>
    </>
  )
}

/**
 * One mailbox in Settings → Mailboxes: the address, its inbox's state, and
 * under it the inbox's details or the form that connects it. The page adds
 * its own actions (edit, delete), a badge about the address's domain, and
 * an editor for the address that takes the row's place while it's open.
 */
export function SenderInbox({
  sender,
  box,
  extraActions,
  extraBadge,
  editor,
  serverReady = true,
}: {
  sender: { id: number; name: string; email: string }
  box: MailboxView | null
  extraActions?: ReactNode
  extraBadge?: ReactNode
  editor?: ReactNode
  /** Whether the workspace's mail server can send from this address (where the host sends, its domain is set up). */
  serverReady?: boolean
}) {
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
  const sends = !box ? null : box.sending?.active ? 'replies and sequence emails' : 'replies only'

  return (
    <SettingsRow
      icon={<Inbox className="h-4 w-4" />}
      title={sender.name || sender.email}
      // The address is the title when the sender has no name.
      detail={[sender.name ? sender.email : null, state, sends].filter(Boolean).join(' · ') || undefined}
      badge={extraBadge}
      // The inbox column: its state, or the button that connects it, at a fixed width so states line up down the list.
      actions={
        <>
          <span className="flex w-32 justify-start">
            {box ? (
              box.status === 'ok' ? (
                <Badge variant="success" status>
                  Connected
                </Badge>
              ) : (
                <Badge variant="error" status>
                  {box.status === 'auth_failed' ? 'Login refused' : 'Not working'}
                </Badge>
              )
            ) : !editing && !editor ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Connect inbox
              </Button>
            ) : null}
          </span>
          {extraActions}
        </>
      }
    >
      {editor ? (
        editor
      ) : box && !editing ? (
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
          <InboxSending box={box} serverReady={serverReady} onChange={refresh} />
        </div>
      ) : box || editing ? (
        <ConnectForm sender={sender} box={box} onDone={() => setEditing(false)} />
      ) : null}
    </SettingsRow>
  )
}

/**
 * How a connected inbox sends its sender's sequence emails: through it (the
 * default once it has checked out), or the workspace's mail server, and why;
 * or, where that server can't send from the address yet either, that they wait.
 */
function InboxSending({ box, serverReady, onChange }: { box: MailboxView; serverReady: boolean; onChange: () => void }) {
  const s = box.sending
  const [cap, setCap] = useState(s?.daily_cap ?? 40)
  const set = useMutation({ mutationFn: (input: { useServer?: boolean; dailyCap?: number }) => setMailboxSendingFn({ data: { id: box.id, ...input } }), onSuccess: onChange })
  const recheck = useMutation({ mutationFn: () => recheckMailboxSendingFn({ data: { id: box.id } }), onSuccess: onChange })
  const error = (set.error ?? recheck.error) as Error | null
  const stopped = !!s?.verified_at && !s.use_server && s.status !== 'ok'

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3 text-sm">
      <p className="font-medium text-foreground">Sequence emails</p>
      {!s ? (
        <p className="text-muted-foreground">
          {box.status === 'ok'
            ? 'Whether they can go out through this mailbox is checked in the next few minutes.'
            : 'Whether they can go out through this mailbox is checked once its inbox can be read again.'}
        </p>
      ) : s.active ? (
        <p className="text-muted-foreground">
          They go out through this mailbox: {s.sent_24h} in the last 24 hours, a few minutes apart, across all of this sender's sequences.
        </p>
      ) : stopped ? (
        <Notice level="error" className="break-words">
          Sending through this mailbox has stopped, so this sender's sequences are paused: {s.last_error}
        </Notice>
      ) : s.use_server ? (
        serverReady ? (
          <p className="text-muted-foreground">They go through the workspace's mail server.</p>
        ) : (
          <Notice level="warning" className="break-words">
            They're set to go through the workspace's mail server, which can't send from this address until its domain is set up in Settings → Sending, so this sender's sequences
            can't start. Switch sending through this mailbox back on below, or set the domain up.
          </Notice>
        )
      ) : (
        <Notice level="warning" className="break-words">
          {serverReady
            ? `They go through the workspace's mail server for now: this mailbox couldn't send. ${s.last_error ?? ''}`
            : `This mailbox couldn't send, and the workspace's mail server can't send from this address until its domain is set up in Settings → Sending, so this sender's sequences can't start. ${s.last_error ?? ''}`}
        </Notice>
      )}
      {s?.verified_at && (
        <div className="flex items-start gap-3">
          <Switch checked={!s.use_server} onChange={(on) => set.mutate({ useServer: !on })} disabled={set.isPending} label="Send sequence emails through this mailbox" />
          <div>
            <p className="text-foreground">Send them through this mailbox</p>
            <p className="text-xs text-muted-foreground">Email from a person's own mailbox reaches the inbox more often. Off, they go through the workspace's mail server.</p>
          </div>
        </div>
      )}
      {s?.active && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Most a day" className="w-28">
            <input type="number" min={1} max={150} value={cap} onChange={(e) => setCap(Math.max(1, Math.min(150, Number(e.target.value) || 1)))} className={`${INPUT_CLASS} tabular-nums`} />
          </Field>
          {cap !== s.daily_cap && (
            <Button size="sm" isLoading={set.isPending} onClick={() => set.mutate({ dailyCap: cap })}>
              Save
            </Button>
          )}
          <p className="basis-full text-xs text-muted-foreground">Mail services limit what one mailbox sends: 30–50 cold emails a day keeps it in good standing.</p>
        </div>
      )}
      {error && <Notice level="error">{error.message}</Notice>}
      {s && (stopped || !s.verified_at) && (
        <SettingsActions>
          <Button size="sm" variant="outline" isLoading={recheck.isPending} onClick={() => recheck.mutate()}>
            Check sending again
          </Button>
        </SettingsActions>
      )}
    </div>
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
  // Sending: the server that goes with the inbox unless one is typed in, and the inbox's login unless another is.
  const [smtpOpen, setSmtpOpen] = useState(false)
  const [smtpHost, setSmtpHost] = useState(box?.sending?.host ?? '')
  const [smtpPort, setSmtpPort] = useState<587 | 465>(box?.sending?.port === 465 ? 465 : 587)
  const [smtpUser, setSmtpUser] = useState(box?.sending?.user ?? '')
  const [smtpPassword, setSmtpPassword] = useState('')
  // The sending server is sent only when it's changed; emptied, it goes back to the one that goes with the inbox.
  const smtpChanged = smtpHost.trim() !== (box?.sending?.host ?? '') || smtpPort !== (box?.sending?.port ?? 587)
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
          ...(smtpOpen
            ? {
                smtp: {
                  ...(smtpChanged ? { host: smtpHost.trim(), port: smtpPort } : {}),
                  user: smtpUser.trim(),
                  ...(smtpPassword ? { password: smtpPassword } : {}),
                },
              }
            : {}),
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
          Microsoft 365 and Outlook don't allow password logins to an inbox from other apps, so they can't be connected this way yet. Their sequence
          emails go through the workspace's mail server, and replies are marked by hand on the sequence's People tab for now.
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
          {service === 'zoho' && (
            <Notice title="Before you connect a Zoho inbox:">
              <ol className="list-decimal pl-4">
                <li>
                  Switch on IMAP for the address: in Zoho Mail, Settings → Mail Accounts → IMAP Access. It's off until you turn it on.
                </li>
                <li>
                  If you sign in to Zoho with two-factor, make an application-specific password (your Zoho account → Security → App Passwords) and paste
                  that below; your normal password is refused.
                </li>
                <li>Use the full email address as the login. The app finds the right Zoho server for your region by itself.</li>
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
            <Field
              label={service === 'gmail' ? 'App password' : service === 'zoho' ? 'Password, or app password with two-factor' : 'Password'}
              hint={box ? 'Left empty, the saved one is kept.' : undefined}
            >
              <SecretInput id={`pass-${sender.id}`} value={password} onChange={setPassword} placeholder="" />
            </Field>
          </FieldGrid>
          <div>
            <button type="button" className="text-sm text-accent hover:underline" aria-expanded={smtpOpen} onClick={() => setSmtpOpen((v) => !v)}>
              {smtpOpen ? 'Hide sending settings' : 'Sending settings'}
            </button>
            {!smtpOpen && (
              <p className="mt-1 text-xs text-muted-foreground">
                {custom
                  ? 'Its sending (SMTP) server is taken to be the IMAP server with smtp. in place of imap.; set it here if not.'
                  : 'Sequence emails are sent through the same service, with the same login.'}
              </p>
            )}
          </div>
          {smtpOpen && (
            <>
              <FieldGrid cols={3}>
                <Field
                  label="Sending (SMTP) server"
                  className="sm:col-span-2"
                  hint={custom ? 'Left empty, the IMAP server with smtp. in place of imap.' : 'Left empty, the one that goes with the inbox.'}
                >
                  <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder={custom ? 'smtp.example.com' : 'The one that goes with the inbox'} className={INPUT_CLASS} />
                </Field>
                <Field label="Port" hint="465 only where the service says SSL.">
                  <Select value={String(smtpPort)} onChange={(e) => setSmtpPort(e.target.value === '465' ? 465 : 587)} className={INPUT_CLASS}>
                    <option value="587">587</option>
                    <option value="465">465 (SSL)</option>
                  </Select>
                </Field>
              </FieldGrid>
              <FieldGrid>
                <Field label="Sending login" hint="Only if it isn't the inbox's.">
                  <input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder={user} className={INPUT_CLASS} autoComplete="off" />
                </Field>
                <Field label="Sending password" hint={box?.sending?.has_own_password ? 'Left empty, the saved one is kept.' : "Left empty, the inbox's."}>
                  <SecretInput id={`smtp-pass-${sender.id}`} value={smtpPassword} onChange={setSmtpPassword} placeholder="" />
                </Field>
              </FieldGrid>
            </>
          )}
          {save.error && <Notice level="error">{(save.error as Error).message}</Notice>}
          <p className="text-xs text-muted-foreground">
            Checking also sends one email from this mailbox to itself, to make sure {sender.email}'s sequence emails can go out through it. It can take
            up to half a minute.
          </p>
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
