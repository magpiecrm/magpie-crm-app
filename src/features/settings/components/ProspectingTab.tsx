import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, ExternalLink, Plus, RefreshCw, Save, ShieldCheck, Trash2, X, Zap } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { SecretInput } from '../../../components/ui/SecretInput'
import {
  getProspectingSettingsFn,
  prospectingStatusFn,
  saveProspectingSettingsFn,
  testSocialFetchKeyFn,
  testVerificationFn,
} from '../../../server/functions'
import { SenderHealthPanel } from './SenderHealthPanel'

const INPUT_CLASS =
  'w-full bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent'

type Masked = Awaited<ReturnType<typeof getProspectingSettingsFn>>
type VerificationTest = Awaited<ReturnType<typeof testVerificationFn>>

interface ProxyRow {
  label: string
  host: string
  port: string
  username: string
  /** Blank keeps the saved password. */
  password: string
  passwordSet: boolean
}

const toRows = (s: Masked): ProxyRow[] =>
  s.proxies.list.map((p) => ({ label: p.label, host: p.host, port: String(p.port), username: p.username, password: '', passwordSet: p.passwordSet }))

export function ProspectingTab() {
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState<Masked | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Secrets start blank: a blank secret field means "keep what's saved".
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState<'reacher' | 'none'>('none')
  const [verifiedOnly, setVerifiedOnly] = useState(true)
  const [dailyCap, setDailyCap] = useState('')
  const [reacherUrl, setReacherUrl] = useState('')
  const [reacherSecret, setReacherSecret] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [helloName, setHelloName] = useState('')

  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [proxies, setProxies] = useState<ProxyRow[]>([])
  // Only send the list when edited, so env-var proxies aren't copied into
  // the database by an unrelated save.
  const [proxiesDirty, setProxiesDirty] = useState(false)
  const updateProxy = (i: number, patch: Partial<ProxyRow>) => {
    setProxies((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setProxiesDirty(true)
  }

  const [isVerifying, setIsVerifying] = useState(false)
  const [verification, setVerification] = useState<VerificationTest | null>(null)
  const [verificationError, setVerificationError] = useState('')

  const { data: status } = useQuery({
    queryKey: queryKeys.prospects.status(),
    queryFn: () => prospectingStatusFn(),
    refetchInterval: 60000,
  })
  const proxyHealth = status?.reacher.proxies ?? []

  const apply = (s: Masked) => {
    setSettings(s)
    setApiKey('')
    setReacherSecret('')
    setReacherUrl(s.reacher.url)
    setFromEmail(s.reacher.fromEmail)
    setHelloName(s.reacher.helloName)
    setVerifiedOnly(s.verification.verifiedOnly)
    setDailyCap(String(s.verification.dailyCap))
    // Nothing chosen yet: show whatever is actually in use.
    setProvider(s.verification.chosen ?? s.verification.active ?? 'none')
    setProxies(toRows(s))
    setProxiesDirty(false)
  }

  useEffect(() => {
    getProspectingSettingsFn()
      .then(apply)
      .catch((e) => setError(e?.message || 'Failed to load settings'))
      .finally(() => setIsLoading(false))
  }, [])

  const refreshSidebar = () => queryClient.invalidateQueries({ queryKey: queryKeys.prospects.status() })

  const save = async (extra: { clear?: Array<'socialfetchApiKey' | 'reacherSecret'> } = {}) => {
    setIsSaving(true)
    setError('')
    setSuccess('')
    try {
      const next = await saveProspectingSettingsFn({
        data: {
          socialfetchApiKey: apiKey || undefined,
          reacherUrl,
          reacherSecret: reacherSecret || undefined,
          reacherFromEmail: fromEmail,
          reacherHelloName: helloName,
          verificationProvider: provider,
          verifiedOnly,
          verificationDailyCap: dailyCap && Number(dailyCap) > 0 ? Number(dailyCap) : undefined,
          proxies: proxiesDirty
            ? proxies
                .filter((p) => p.host.trim())
                .map((p) => ({
                  label: p.label || undefined,
                  host: p.host,
                  port: Number(p.port),
                  username: p.username || undefined,
                  password: p.password || undefined,
                }))
            : undefined,
          ...extra,
        },
      })
      apply(next)
      setSuccess(extra.clear?.length ? 'Removed.' : 'Saved. Prospect search uses these settings right away.')
      refreshSidebar()
    } catch (e: any) {
      setError(e?.message || 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const runVerificationTest = async () => {
    setIsVerifying(true)
    setVerification(null)
    setVerificationError('')
    try {
      setVerification(await testVerificationFn())
      refreshSidebar()
    } catch (e: any) {
      setVerificationError(e?.message || 'Test failed')
    } finally {
      setIsVerifying(false)
    }
  }

  const test = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await testSocialFetchKeyFn({ data: { apiKey: apiKey || undefined } })
      setTestResult(
        res.ok
          ? {
              ok: true,
              message:
                res.balance === null
                  ? 'Connected to SocialFetch.'
                  : `Connected. ${res.balance.toLocaleString()} credits available.` +
                    (apiKey ? ' Save to start using this key.' : ''),
            }
          : { ok: false, message: res.error },
      )
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message || 'Test failed' })
    } finally {
      setIsTesting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
        <RefreshCw className="w-5 h-5 animate-spin text-accent" />
        <span>Loading prospecting settings...</span>
      </div>
    )
  }

  const sf = settings?.socialfetch

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      className="flex flex-col gap-6"
    >
      {settings?.credsUnreadable && (
        <div className="flex items-start gap-2.5 p-3 bg-destructive/10 border border-destructive/20 rounded-md-s text-xs text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Saved keys can't be read</span>
            The encryption secret changed since they were saved. Enter your SocialFetch key again and save.
          </div>
        </div>
      )}
      {settings?.usingDefaultEncryptionSecret && (
        <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Set an encryption secret</span>
            Keys are encrypted with a development-only default. Set <code className="font-mono">CREDENTIALS_SECRET</code>{' '}
            before saving real keys.
          </div>
        </div>
      )}

      {/* SocialFetch */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          SocialFetch
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          SocialFetch supplies the company and people data behind Prospect Search. Each search page costs 3 credits.{' '}
          <a
            href="https://www.socialfetch.dev"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline inline-flex items-center gap-0.5"
          >
            Get an API key <ExternalLink className="w-3 h-3" />
          </a>
        </p>

        <div className="flex flex-col gap-1.5 max-w-xl">
          <label htmlFor="socialfetch-key" className="text-xs font-semibold text-foreground">
            API key
          </label>
          <SecretInput
            id="socialfetch-key"
            value={apiKey}
            onChange={(v) => {
              setApiKey(v)
              setTestResult(null)
            }}
            placeholder={sf?.isSet ? `Saved (${sf.hint}). Enter a new key to replace it` : 'sfk_...'}
          />
          <span className="text-xs text-muted-foreground">
            {sf?.source === 'db' && `Saved here and stored encrypted (${sf.hint}).`}
            {sf?.source === 'env' && (
              <>
                Currently using <code className="font-mono">SOCIALFETCH_API_KEY</code> from the environment ({sf.hint}). A
                key saved here takes priority.
              </>
            )}
            {!sf?.source && 'No key yet. Prospect search stays off until you add one.'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={test}
            disabled={isTesting || (!apiKey && !sf?.isSet)}
            className="py-2 px-3 border border-border bg-card hover:bg-muted disabled:opacity-50 text-sm font-semibold rounded-md-s flex items-center gap-2 cursor-pointer"
          >
            {isTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Test connection
          </button>
          {sf?.source === 'db' && !apiKey && (
            <button
              type="button"
              onClick={() => save({ clear: ['socialfetchApiKey'] })}
              disabled={isSaving}
              className="py-2 px-3 text-sm font-semibold text-destructive hover:bg-destructive/10 rounded-md-s flex items-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              Remove saved key
            </button>
          )}
        </div>
        {testResult && (
          <div
            className={`flex items-start gap-2 p-3 rounded-md-s text-xs border max-w-xl ${
              testResult.ok
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-destructive/10 border-destructive/20 text-destructive'
            }`}
          >
            {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{testResult.message}</span>
          </div>
        )}
      </div>

      {/* Verification provider */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          Email verification
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          How found emails are checked before they're shown or saved. Without verification, every email is an unverified
          best guess.
        </p>
        <div role="radiogroup" aria-label="Verification provider" className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-2xl">
          {(
            [
              ['none', 'Off', 'Best guesses only'],
              ['reacher', 'Reacher', 'Self-hosted, free. Checks come from your server or proxies.'],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={`flex items-start gap-2 p-3 rounded-md-s border cursor-pointer transition-colors ${
                provider === value ? 'border-accent bg-accent/5' : 'border-border hover:bg-muted/40'
              }`}
            >
              <input
                type="radio"
                name="verification-provider"
                className="mt-0.5 text-accent focus:ring-accent"
                checked={provider === value}
                onChange={() => setProvider(value)}
              />
              <span>
                <span className="block text-sm font-semibold text-foreground">{label}</span>
                <span className="block text-[11px] text-muted-foreground leading-snug">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer max-w-2xl">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-border text-accent focus:ring-accent"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
          />
          <span>
            <span className="font-semibold">Only give verified emails (recommended)</span>
            <span className="block text-[11px] text-muted-foreground leading-snug">
              Reveal and Save only hand over addresses the company's mail server confirmed. Catch-all, risky and
              unconfirmed guesses are withheld with the reason, which keeps bounces off your sending domain.
              {provider === 'none' && ' With verification off, nothing can be confirmed, so no emails will be given.'}
            </span>
          </span>
        </label>

        {settings?.verification.active && settings.verification.active !== provider && (
          <p className="text-xs text-accent">Currently using Reacher. Save to switch.</p>
        )}

      </div>

      {provider === 'reacher' && (
        <>
        {/* Reacher */}
        <div className="flex flex-col gap-3">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
            Reacher (self-hosted)
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
            Point this at a self-hosted{' '}
            <a
              href="https://github.com/reacherhq/check-if-email-exists"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              Reacher
            </a>{' '}
            server (<code className="font-mono">bun run reacher:up</code>). Checks come from its IP, or the proxies below.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reacher-url" className="text-xs font-semibold text-foreground">Reacher URL</label>
              <input
                id="reacher-url"
                type="url"
                autoComplete="off"
                value={reacherUrl}
                onChange={(e) => setReacherUrl(e.target.value)}
                placeholder="http://reacher:8080"
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reacher-secret" className="text-xs font-semibold text-foreground">Reacher secret</label>
              <SecretInput
                id="reacher-secret"
                value={reacherSecret}
                onChange={setReacherSecret}
                placeholder={settings?.reacher.secretIsSet ? 'Saved. Enter a new one to replace it' : 'Only if RCH__HEADER_SECRET is set'}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reacher-from" className="text-xs font-semibold text-foreground">FROM address</label>
              <input
                id="reacher-from"
                type="email"
                autoComplete="off"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="verify@yourdomain.com"
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="reacher-helo" className="text-xs font-semibold text-foreground">HELO name</label>
              <input
                id="reacher-helo"
                type="text"
                autoComplete="off"
                value={helloName}
                onChange={(e) => setHelloName(e.target.value)}
                placeholder="mail.yourdomain.com"
                className={INPUT_CLASS}
              />
              <span className="text-xs text-muted-foreground">Should match the reverse DNS of the IP that verifies.</span>
            </div>
          </div>
        </div>

        {/* Proxies */}
        <div className="flex flex-col gap-3">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
            Verification proxies (optional)
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
            SOCKS5 proxies on servers with outbound port 25 open. Checks rotate across them, with stricter limits for Gmail
            and Microsoft, and a proxy that starts getting blocked is benched for 15 minutes. With none, Reacher connects
            directly from its own IP. Setup guide: <code className="font-mono">docs/proxies.md</code>.
          </p>
          {settings?.proxies.source === 'env' && !proxiesDirty && (
            <p className="text-xs text-accent">Loaded from REACHER_PROXIES. Editing and saving here stores them in Settings instead.</p>
          )}

          {proxies.length > 0 && (
            <div className="flex flex-col gap-2 max-w-4xl">
              {proxies.map((p, i) => (
                <div key={i} className="grid grid-cols-2 md:grid-cols-[1fr_1.4fr_0.6fr_1fr_1fr_auto] gap-2 items-center">
                  <input aria-label="Label" className={INPUT_CLASS} placeholder="Label (e.g. eu-1)" value={p.label} onChange={(e) => updateProxy(i, { label: e.target.value })} />
                  <input aria-label="Host" className={INPUT_CLASS} placeholder="Host or IP" value={p.host} onChange={(e) => updateProxy(i, { host: e.target.value })} />
                  <input aria-label="Port" className={INPUT_CLASS} placeholder="1080" inputMode="numeric" value={p.port} onChange={(e) => updateProxy(i, { port: e.target.value.replace(/\D/g, '') })} />
                  <input aria-label="Username" className={INPUT_CLASS} placeholder="Username" autoComplete="off" value={p.username} onChange={(e) => updateProxy(i, { username: e.target.value })} />
                  <SecretInput id={`proxy-password-${i}`} value={p.password} onChange={(v) => updateProxy(i, { password: v })} placeholder={p.passwordSet ? 'Saved' : 'Password'} />
                  <button
                    type="button"
                    aria-label="Remove proxy"
                    onClick={() => {
                      setProxies((rows) => rows.filter((_, j) => j !== i))
                      setProxiesDirty(true)
                    }}
                    className="p-2 text-muted-foreground hover:text-destructive justify-self-start"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div>
            <button
              type="button"
              onClick={() => {
                setProxies((rows) => [...rows, { label: '', host: '', port: '1080', username: '', password: '', passwordSet: false }])
                setProxiesDirty(true)
              }}
              className="py-1.5 px-3 border border-border bg-card hover:bg-muted text-xs font-semibold rounded-md-s inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add proxy
            </button>
          </div>

          <div className="flex flex-col gap-1.5 max-w-xs">
            <label htmlFor="daily-cap" className="text-xs font-semibold text-foreground">Daily checks per IP</label>
            <input
              id="daily-cap"
              inputMode="numeric"
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value.replace(/\D/g, ''))}
              className={INPUT_CLASS}
            />
            <span className="text-[11px] text-muted-foreground leading-snug">
              Each verifying IP stops for the day after this many checks; add another proxy for more. Checks to one
              company are also paced (up to 12 at once, then about 4 a minute) and stop for the day after 20 rejected
              guesses, which is what address harvesting looks like.
            </span>
          </div>

          {proxyHealth.length > 0 && (
            <div className="max-w-3xl border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Proxy</th>
                    <th className="text-right px-3 py-2 font-semibold">OK</th>
                    <th className="text-right px-3 py-2 font-semibold">Greylisted</th>
                    <th className="text-right px-3 py-2 font-semibold">Blocked</th>
                    <th className="text-right px-3 py-2 font-semibold">Timeouts</th>
                    <th className="text-right px-3 py-2 font-semibold" title="Company mail servers that refused a connection from this proxy">Unreachable</th>
                    <th className="text-right px-3 py-2 font-semibold" title="Checks refused because of the verification domain, not this IP">Domain refused</th>
                    <th className="text-right px-3 py-2 font-semibold">Today</th>
                    <th className="text-left px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {proxyHealth.map((h) => (
                    <tr key={h.label}>
                      <td className="px-3 py-2 font-medium text-foreground">{h.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.ok}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.greylisted}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.blocked}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.timeouts}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.unreachable ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.senderRejected ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {h.checksToday ?? 0} / {h.dailyCap ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        {h.paused ? (
                          <span className="text-destructive" title={h.paused}>Paused: blocklisted</span>
                        ) : h.benchedUntil ? (
                          <span className="text-destructive">Resting until {new Date(h.benchedUntil).toLocaleTimeString()}</span>
                        ) : h.checksToday >= h.dailyCap ? (
                          <span className="text-amber-600 dark:text-amber-400">Daily limit reached</span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">Active</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border">Counts since the app last started.</p>
            </div>
          )}
        </div>
        </>
      )}

      {/* Shown for the saved setup: the check runs against what's saved, not the form. */}
      {settings?.verification.active === 'reacher' && (
        <SenderHealthPanel
          listedDomainOverride={settings?.verification.listedDomainOverride ?? null}
          onOverrideChange={async (domain) => {
            apply(await saveProspectingSettingsFn({ data: { listedDomainOverride: domain } }))
            refreshSidebar()
          }}
        />
      )}

      {/* Test */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          Test verification
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          Checks a made-up address at Gmail and at Microsoft 365 through Reacher, directly or via each proxy. No real
          mailbox is contacted. Save your changes first.
        </p>
        <div>
          <button
            type="button"
            onClick={runVerificationTest}
            disabled={isVerifying}
            className="py-2 px-3 border border-border bg-card hover:bg-muted disabled:opacity-50 text-sm font-semibold rounded-md-s inline-flex items-center gap-2 cursor-pointer"
          >
            {isVerifying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {isVerifying ? 'Testing…' : 'Test verification'}
          </button>
        </div>
        {verificationError && <p className="text-xs text-destructive">{verificationError}</p>}
        {verification && !verification.configured && (
          <p className="text-xs text-destructive">
            Verification is off, or the chosen service isn't set up yet. Pick one above, fill it in and save first.
          </p>
        )}
        {verification?.configured && (
          <div className="max-w-3xl border border-border divide-y divide-border">
            {verification.results.map((r, i) => (
              <div key={i} className="px-3 py-2 flex items-start gap-2 text-xs">
                {r.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                )}
                <div className="min-w-0">
                  <span className="font-semibold text-foreground">{r.via}</span>
                  <span className="text-muted-foreground"> → {r.provider} · {(r.ms / 1000).toFixed(1)}s</span>
                  {r.detail && <p className="text-muted-foreground mt-0.5 break-words">{r.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md-s flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm rounded-md-s flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={isSaving}
        className="w-full md:w-auto md:self-end py-2.5 px-6 bg-primary hover:bg-primary/85 disabled:opacity-50 text-primary-foreground text-sm font-semibold rounded-md-s transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
      >
        {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        <span>{isSaving ? 'Saving...' : 'Save prospecting settings'}</span>
      </button>
    </form>
  )
}
