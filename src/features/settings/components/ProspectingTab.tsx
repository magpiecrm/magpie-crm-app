import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertCircle, CheckCircle2, ExternalLink, Pencil, Plus, RefreshCw, Save, Server, ShieldCheck, Trash2, Zap } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { SecretInput } from '../../../components/ui/SecretInput'
import {
  getProspectingSettingsFn,
  prospectingStatusFn,
  saveProspectingSettingsFn,
  testSocialFetchKeyFn,
  testVerificationFn,
} from '../../../server/functions'
import { SenderHealthPanel } from './SenderHealthPanel'
import { SettingsActions, SettingsBlock, SettingsCheck, SettingsEmpty, SettingsList, SettingsOption, SettingsPanel, SettingsRow } from './SettingsBlock'

type Masked = Awaited<ReturnType<typeof getProspectingSettingsFn>>
type VerificationTest = Awaited<ReturnType<typeof testVerificationFn>>
type ProxyHealth = NonNullable<Awaited<ReturnType<typeof prospectingStatusFn>>>['reacher']['proxies'][number]

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

/** A proxy's row when it's closed: where it connects, and as whom. */
const proxySummary = (p: ProxyRow) => (p.host.trim() ? `${p.host}:${p.port}${p.username ? ` · ${p.username}` : ''}` : 'No host yet')

function ProxyStatus({ health: h }: { health: ProxyHealth }) {
  if (h.paused) {
    return (
      <span title={h.paused}>
        <Badge variant="error">Paused: blocklisted</Badge>
      </span>
    )
  }
  if (h.benchedUntil) return <Badge variant="error">Resting until {new Date(h.benchedUntil).toLocaleTimeString()}</Badge>
  if (h.checksToday >= h.dailyCap) return <Badge variant="warning">Daily limit reached</Badge>
  return <Badge variant="success">Active</Badge>
}

/**
 * Settings → Data source (the SocialFetch key) or Email verification
 * (verification server, proxies, health, test). One form behind both pages: they share
 * the saved prospecting settings, and blank secret fields mean "keep".
 */
export function ProspectingTab({ section }: { section: 'source' | 'verification' }) {
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
  // The one proxy whose fields are open, by its place in the list.
  const [editingProxy, setEditingProxy] = useState<number | null>(null)
  const updateProxy = (i: number, patch: Partial<ProxyRow>) => {
    setProxies((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setProxiesDirty(true)
  }
  const addProxy = () => {
    setEditingProxy(proxies.length)
    setProxies((rows) => [...rows, { label: '', host: '', port: '1080', username: '', password: '', passwordSet: false }])
    setProxiesDirty(true)
  }
  const removeProxy = (i: number) => {
    setProxies((rows) => rows.filter((_, j) => j !== i))
    setProxiesDirty(true)
    // The rows after it move up one.
    setEditingProxy((open) => (open === null || open === i ? null : open > i ? open - 1 : open))
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
    setEditingProxy(null)
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
      <div className="flex flex-col gap-4">
        <SettingsEmpty>
          <RefreshCw className="mr-2 inline h-4 w-4 animate-spin text-accent" />
          Loading…
        </SettingsEmpty>
      </div>
    )
  }

  const sf = settings?.socialfetch

  // How the last save (or the first load) went: shown in the block that holds the Save button.
  const saveResult = (
    <>
      {error && <Notice level="error">{error}</Notice>}
      {success && <Notice level="success">{success}</Notice>}
    </>
  )
  const saveButton = (
    <Button type="submit" isLoading={isSaving} leftIcon={<Save className="h-4 w-4" />}>
      Save changes
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      {settings?.credsUnreadable && (
        <Notice level="error" title="Saved keys can't be read">
          The encryption secret changed since they were saved. Enter your SocialFetch key again and save.
        </Notice>
      )}
      {settings?.usingDefaultEncryptionSecret && (
        <Notice title="Set an encryption secret">
          Keys are encrypted with a development-only default. Set <code className="font-mono">CREDENTIALS_SECRET</code> before
          saving real keys.
        </Notice>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <SettingsPanel>
          {section === 'source' && (
            <SettingsBlock
              title="SocialFetch"
              description={
                <p>
                  SocialFetch supplies the company and people data behind prospect search. Each search page costs 3 credits.{' '}
                  <a
                    href="https://www.socialfetch.dev"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-accent hover:underline"
                  >
                    Get an API key <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              }
            >
              <Field
                label="API key"
                hint={
                  <>
                    {sf?.source === 'db' && `Saved here and stored encrypted (${sf.hint}).`}
                    {sf?.source === 'env' && (
                      <>
                        Currently using <code className="font-mono">SOCIALFETCH_API_KEY</code> from the environment ({sf.hint}). A
                        key saved here takes priority.
                      </>
                    )}
                    {!sf?.source && 'No key yet. Prospect search stays off until you add one.'}
                  </>
                }
              >
                <SecretInput
                  id="socialfetch-key"
                  value={apiKey}
                  onChange={(v) => {
                    setApiKey(v)
                    setTestResult(null)
                  }}
                  placeholder={sf?.isSet ? `Saved (${sf.hint}). Enter a new key to replace it` : 'sfk_...'}
                />
              </Field>
              {testResult && <Notice level={testResult.ok ? 'success' : 'error'}>{testResult.message}</Notice>}
              {saveResult}
              <SettingsActions>
                {saveButton}
                <Button
                  type="button"
                  variant="outline"
                  onClick={test}
                  isLoading={isTesting}
                  disabled={!apiKey && !sf?.isSet}
                  leftIcon={<Zap className="h-4 w-4" />}
                >
                  Test connection
                </Button>
                {sf?.source === 'db' && !apiKey && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => save({ clear: ['socialfetchApiKey'] })}
                    disabled={isSaving}
                    leftIcon={<Trash2 className="h-4 w-4" />}
                  >
                    Remove saved key
                  </Button>
                )}
              </SettingsActions>
            </SettingsBlock>
          )}

          {section === 'verification' && (
            <>
              {/* Verification provider */}
              <SettingsBlock title="Verification service" description="Without verification, every email is an unverified best guess.">
                <div role="radiogroup" aria-label="Verification provider">
                  <FieldGrid>
                    <SettingsOption selected={provider === 'none'} onSelect={() => setProvider('none')} title="Off" detail="Best guesses only." />
                    <SettingsOption
                      selected={provider === 'reacher'}
                      onSelect={() => setProvider('reacher')}
                      title="Verification server"
                      detail="Self-hosted, free. Checks come from your server or proxies."
                    />
                  </FieldGrid>
                </div>
                <SettingsCheck
                  checked={verifiedOnly}
                  onChange={setVerifiedOnly}
                  label="Only give verified emails (recommended)"
                  hint={
                    <>
                      Reveal and Save only hand over addresses the company's mail server confirmed. Catch-all, risky and
                      unconfirmed guesses are withheld with the reason, which keeps bounces off your sending domain.
                      {provider === 'none' && ' With verification off, nothing can be confirmed, so no emails will be given.'}
                    </>
                  }
                />
                {settings?.verification.active && settings.verification.active !== provider && (
                  <Notice>Currently using the verification server. Save to switch.</Notice>
                )}
              </SettingsBlock>

              {provider === 'reacher' && (
                <>
                  {/* Verification server */}
                  <SettingsBlock
                    title="Server"
                    description={
                      <p>
                        Point this at your self-hosted email verification server (start one with{' '}
                        <code className="font-mono">bun run verifier:up</code>). Checks come from its IP, or the proxies below.
                      </p>
                    }
                  >
                    <FieldGrid>
                      <Field label="Server URL">
                        <input
                          type="url"
                          autoComplete="off"
                          value={reacherUrl}
                          onChange={(e) => setReacherUrl(e.target.value)}
                          placeholder="http://localhost:8080"
                          className={INPUT_CLASS}
                        />
                      </Field>
                      <Field label="Server secret">
                        <SecretInput
                          id="reacher-secret"
                          value={reacherSecret}
                          onChange={setReacherSecret}
                          placeholder={settings?.reacher.secretIsSet ? 'Saved. Enter a new one to replace it' : 'Only if RCH__HEADER_SECRET is set'}
                        />
                      </Field>
                      <Field label="FROM address">
                        <input
                          type="email"
                          autoComplete="off"
                          value={fromEmail}
                          onChange={(e) => setFromEmail(e.target.value)}
                          placeholder="verify@yourdomain.com"
                          className={INPUT_CLASS}
                        />
                      </Field>
                      <Field label="HELO name" hint="Should match the reverse DNS of the IP that verifies.">
                        <input
                          type="text"
                          autoComplete="off"
                          value={helloName}
                          onChange={(e) => setHelloName(e.target.value)}
                          placeholder="mail.yourdomain.com"
                          className={INPUT_CLASS}
                        />
                      </Field>
                    </FieldGrid>
                  </SettingsBlock>

                  {/* Proxies */}
                  <SettingsBlock
                    title="Proxies"
                    description={
                      <p>
                        Optional. SOCKS5 proxies on servers with outbound port 25 open. Checks rotate across them, with stricter
                        limits for Gmail and Microsoft, and a proxy that starts getting blocked is benched for 15 minutes. With
                        none, the server connects directly from its own IP. Setup guide:{' '}
                        <code className="font-mono">docs/proxies.md</code>.
                      </p>
                    }
                  >
                    {settings?.proxies.source === 'env' && !proxiesDirty && (
                      <Notice>Loaded from REACHER_PROXIES. Editing and saving here stores them in Settings instead.</Notice>
                    )}

                    {proxies.length === 0 ? (
                      <SettingsEmpty>No proxies. Checks come from the server's own IP.</SettingsEmpty>
                    ) : (
                      <SettingsList>
                        {proxies.map((p, i) => {
                          const name = p.label || p.host || 'New proxy'
                          const isEditing = editingProxy === i
                          return (
                            <SettingsRow
                              key={i}
                              icon={<Server className="h-4 w-4" />}
                              title={name}
                              detail={proxySummary(p)}
                              actions={
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setEditingProxy(isEditing ? null : i)}
                                    aria-label={`Edit ${name}`}
                                    aria-expanded={isEditing}
                                    title="Edit"
                                    leftIcon={<Pencil className="h-4 w-4" />}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeProxy(i)}
                                    aria-label={`Remove ${name}`}
                                    title="Remove"
                                    className="hover:!bg-destructive/10 hover:!text-destructive"
                                    leftIcon={<Trash2 className="h-4 w-4" />}
                                  />
                                </>
                              }
                            >
                              {isEditing && (
                                <div className="flex flex-col gap-3">
                                  <FieldGrid cols={3}>
                                    <Field label="Label">
                                      <input className={INPUT_CLASS} placeholder="eu-1" value={p.label} onChange={(e) => updateProxy(i, { label: e.target.value })} />
                                    </Field>
                                    <Field label="Host or IP">
                                      <input className={INPUT_CLASS} value={p.host} onChange={(e) => updateProxy(i, { host: e.target.value })} />
                                    </Field>
                                    <Field label="Port">
                                      <input className={INPUT_CLASS} placeholder="1080" inputMode="numeric" value={p.port} onChange={(e) => updateProxy(i, { port: e.target.value.replace(/\D/g, '') })} />
                                    </Field>
                                  </FieldGrid>
                                  <FieldGrid>
                                    <Field label="Username">
                                      <input className={INPUT_CLASS} autoComplete="off" value={p.username} onChange={(e) => updateProxy(i, { username: e.target.value })} />
                                    </Field>
                                    <Field label="Password">
                                      <SecretInput
                                        id={`proxy-password-${i}`}
                                        value={p.password}
                                        onChange={(v) => updateProxy(i, { password: v })}
                                        placeholder={p.passwordSet ? 'Saved. Enter a new one to replace it' : ''}
                                      />
                                    </Field>
                                  </FieldGrid>
                                  <SettingsActions>
                                    <Button type="button" variant="outline" size="sm" onClick={() => setEditingProxy(null)}>
                                      Done
                                    </Button>
                                  </SettingsActions>
                                </div>
                              )}
                            </SettingsRow>
                          )
                        })}
                      </SettingsList>
                    )}
                    <SettingsActions>
                      <Button type="button" variant="outline" onClick={addProxy} leftIcon={<Plus className="h-4 w-4" />}>
                        Add proxy
                      </Button>
                    </SettingsActions>
                  </SettingsBlock>

                  <SettingsBlock
                    title="Limits"
                    description={
                      <>
                        <p>Each verifying IP stops for the day after this many checks; add another proxy for more.</p>
                        <p>
                          Checks to one company are also paced (up to 12 at once, then about 4 a minute) and stop for the day
                          after 20 rejected guesses, which is what address harvesting looks like.
                        </p>
                      </>
                    }
                  >
                    <FieldGrid>
                      <Field label="Daily checks per IP">
                        <input inputMode="numeric" value={dailyCap} onChange={(e) => setDailyCap(e.target.value.replace(/\D/g, ''))} className={INPUT_CLASS} />
                      </Field>
                    </FieldGrid>
                  </SettingsBlock>

                  {proxyHealth.length > 0 && (
                    <SettingsBlock title="Checks by IP" description="Counts since the app last started.">
                      <SettingsList>
                        {proxyHealth.map((h) => (
                          <SettingsRow
                            key={h.label}
                            icon={<Activity className="h-4 w-4" />}
                            title={h.label}
                            detail={`${h.checksToday ?? 0} / ${h.dailyCap ?? '—'} checks today`}
                            badge={<ProxyStatus health={h} />}
                          >
                            <dl className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                              {(
                                [
                                  ['OK', h.ok],
                                  ['Greylisted', h.greylisted],
                                  ['Blocked', h.blocked],
                                  ['Timeouts', h.timeouts],
                                  ['Unreachable', h.unreachable ?? 0, 'Company mail servers that refused a connection from this proxy'],
                                  ['Domain refused', h.senderRejected ?? 0, 'Checks refused because of the verification domain, not this IP'],
                                ] as Array<[string, number, string?]>
                              ).map(([label, count, title]) => (
                                <div key={label} className="flex gap-1.5" title={title}>
                                  <dt className="text-muted-foreground">{label}</dt>
                                  <dd className="tabular-nums text-foreground">{count}</dd>
                                </div>
                              ))}
                            </dl>
                          </SettingsRow>
                        ))}
                      </SettingsList>
                    </SettingsBlock>
                  )}
                </>
              )}

              <SettingsBlock title="Save" description="The health check and the test below run against what's saved, not the form.">
                {saveResult}
                <SettingsActions>{saveButton}</SettingsActions>
              </SettingsBlock>

              {/* Shown for the saved setup: the check runs against what's saved, not the form. */}
              {settings?.verification.active === 'reacher' && settings.verification.healthChecks && (
                <SenderHealthPanel
                  listedDomainOverride={settings?.verification.listedDomainOverride ?? null}
                  onOverrideChange={async (domain) => {
                    apply(await saveProspectingSettingsFn({ data: { listedDomainOverride: domain } }))
                    refreshSidebar()
                  }}
                />
              )}

              {/* Test */}
              <SettingsBlock
                title="Test"
                description="Checks a made-up address at Gmail and at Microsoft 365 through the verification server, directly or via each proxy. No real mailbox is contacted. Save your changes first."
              >
                {verificationError && <Notice level="error">{verificationError}</Notice>}
                {verification && !verification.configured && (
                  <Notice level="error">Verification is off, or the chosen service isn't set up yet. Pick one above, fill it in and save first.</Notice>
                )}
                {verification?.configured && (
                  <SettingsList>
                    {verification.results.map((r, i) => (
                      <SettingsRow
                        key={i}
                        icon={
                          r.ok ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          )
                        }
                        title={`${r.via} → ${r.provider}`}
                        detail={`${(r.ms / 1000).toFixed(1)}s`}
                      >
                        {r.detail && <p className="break-words text-xs text-muted-foreground">{r.detail}</p>}
                      </SettingsRow>
                    ))}
                  </SettingsList>
                )}
                <SettingsActions>
                  <Button type="button" onClick={runVerificationTest} isLoading={isVerifying} leftIcon={<ShieldCheck className="h-4 w-4" />}>
                    Test verification
                  </Button>
                </SettingsActions>
              </SettingsBlock>
            </>
          )}
        </SettingsPanel>
      </form>
    </div>
  )
}
