import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, ExternalLink, Eye, EyeOff, RefreshCw, Save, Trash2, Zap } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { getProspectingSettingsFn, saveProspectingSettingsFn, testSocialFetchKeyFn } from '../../../server/functions'

const INPUT_CLASS =
  'w-full bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent'

type Masked = Awaited<ReturnType<typeof getProspectingSettingsFn>>

function SecretInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative flex items-center">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        // Browsers ignore autocomplete="off" on password fields; "new-password"
        // plus the password-manager opt-outs keeps saved logins and stray form
        // history from being filled in as an API key.
        autoComplete="new-password"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${INPUT_CLASS} pr-10 font-mono`}
      />
      <button
        type="button"
        aria-label={visible ? 'Hide' : 'Show'}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

export function ProspectingTab() {
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState<Masked | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Secrets start blank: a blank secret field means "keep what's saved".
  const [apiKey, setApiKey] = useState('')
  const [reacherUrl, setReacherUrl] = useState('')
  const [reacherSecret, setReacherSecret] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [helloName, setHelloName] = useState('')

  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const apply = (s: Masked) => {
    setSettings(s)
    setApiKey('')
    setReacherSecret('')
    setReacherUrl(s.reacher.url)
    setFromEmail(s.reacher.fromEmail)
    setHelloName(s.reacher.helloName)
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

      {/* Reacher */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          Email verification (optional)
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
          server to check found emails against the mail server before saving. Without it, emails are saved as unverified
          best guesses.
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
        <span className="text-xs text-muted-foreground">
          {settings?.proxiesConfigured
            ? 'SOCKS5 proxies are set in REACHER_PROXIES.'
            : 'SOCKS5 proxies are set with the REACHER_PROXIES environment variable (see the README).'}
        </span>
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
        className="w-full md:w-auto md:self-end py-2.5 px-6 bg-accent hover:bg-accent/95 disabled:opacity-50 text-accent-foreground text-sm font-semibold rounded-md-s transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
      >
        {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        <span>{isSaving ? 'Saving...' : 'Save prospecting settings'}</span>
      </button>
    </form>
  )
}
