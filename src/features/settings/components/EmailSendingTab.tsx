import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, RefreshCw, Save, Send } from 'lucide-react'
import {
  getEmailSettingsFn,
  saveEmailSettingsFn,
  sendProviderTestEmailFn,
} from '../../../server/functions'
// Descriptors only — importing the provider registry here would pull nodemailer
// and node:crypto into the client bundle.
import type { ProviderDescriptor, ProviderField } from '../../../server/providers/types'

const INPUT_CLASS =
  'w-full bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent'

type FieldState = { value: string; isSet: boolean }
type FieldsByProvider = Record<string, Record<string, FieldState>>

export function EmailSendingTab() {
  const [providers, setProviders] = useState<ProviderDescriptor[]>([])
  const [fields, setFields] = useState<FieldsByProvider>({})
  const [provider, setProvider] = useState<string>('')
  const [defaultSender, setDefaultSender] = useState('')
  const [source, setSource] = useState<'db' | 'env'>('env')
  const [credsUnreadable, setCredsUnreadable] = useState(false)
  const [usingDefaultSecret, setUsingDefaultSecret] = useState(false)

  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [testTo, setTestTo] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const fetchSettings = async () => {
    setIsLoading(true)
    try {
      const res = await getEmailSettingsFn()
      if (!res.success) {
        setError(res.error || 'Failed to load settings')
        return
      }
      setProviders(res.providers as ProviderDescriptor[])
      setFields(res.settings.fields)
      setProvider(res.settings.provider)
      setDefaultSender(res.settings.defaultSender)
      setSource(res.settings.source)
      setCredsUnreadable(res.settings.credsUnreadable)
      setUsingDefaultSecret(res.settings.usingDefaultEncryptionSecret)
    } catch (e: any) {
      setError(e?.message || 'Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const descriptor = providers.find((p) => p.id === provider)
  const current = fields[provider] || {}

  const handleFieldChange = (key: string, value: string) => {
    setFields((prev) => ({
      ...prev,
      [provider]: { ...(prev[provider] || {}), [key]: { value, isSet: value !== '' } },
    }))
  }

  const toggleVisibility = (key: string) => {
    setVisibleFields((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setError('')
    setSuccess('')
    try {
      const credentials: Record<string, string> = {}
      for (const field of descriptor?.fields ?? []) {
        credentials[field.key] = current[field.key]?.value ?? ''
      }

      const res = await saveEmailSettingsFn({
        data: { provider, defaultSender, credentials },
      })

      if (!res.success) {
        setError(res.error || 'Failed to save')
        return
      }
      setSuccess(
        res.missingFields.length
          ? `Saved ${res.label}, but it still needs: ${res.missingFields.join(', ')}. Emails will be logged instead of sent until then.`
          : `${res.label} is now the default sending provider.`,
      )
      await fetchSettings()
      setTimeout(() => setSuccess(''), 6000)
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async () => {
    if (!testTo) return
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await sendProviderTestEmailFn({ data: { to: testTo } })
      setTestResult(
        res.success
          ? { ok: true, message: `Sent via ${res.provider}${res.messageId ? ` (id ${res.messageId})` : ''}.` }
          : { ok: false, message: res.error || 'Send failed' },
      )
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message || 'Send failed' })
    } finally {
      setIsTesting(false)
    }
  }

  const renderField = (field: ProviderField) => {
    const state = current[field.key] || { value: '', isSet: false }
    const id = `${provider}-${field.key}`

    return (
      <div key={field.key} className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-foreground">
          {field.label}
          {field.required && <span className="text-destructive"> *</span>}
        </label>

        {field.type === 'select' ? (
          <select
            value={state.value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            className={INPUT_CLASS}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : field.type === 'secret' ? (
          <div className="relative flex items-center">
            <input
              type={visibleFields[id] ? 'text' : 'password'}
              value={state.value}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              // Secrets are never sent back to the browser, so a saved value
              // shows as empty. Blank on save means "keep what is stored".
              placeholder={state.isSet ? 'Saved — leave blank to keep' : field.placeholder}
              className={INPUT_CLASS + ' pr-10'}
            />
            <button
              type="button"
              onClick={() => toggleVisibility(id)}
              className="absolute right-2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {visibleFields[id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <input
            type={field.type === 'number' ? 'number' : 'text'}
            value={state.value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            className={INPUT_CLASS}
          />
        )}

        {field.help && <span className="text-xs text-muted-foreground">{field.help}</span>}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
        <RefreshCw className="w-5 h-5 animate-spin text-accent" />
        <span>Loading sending settings...</span>
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      {source === 'env' && (
        <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Using environment variables</span>
            <span>
              No provider has been saved yet, so sending falls back to your{' '}
              <code className="font-mono">CLOUDFLARE_*</code> /{' '}
              <code className="font-mono">SMTP_*</code> variables. Saving here overrides them.
            </span>
          </div>
        </div>
      )}

      {credsUnreadable && (
        <div className="flex items-start gap-2.5 p-3 bg-destructive/10 border border-destructive/20 rounded-md-s text-xs text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Stored credentials cannot be read</span>
            <span>
              The encryption secret changed since they were saved. Re-enter the credentials below.
            </span>
          </div>
        </div>
      )}

      {usingDefaultSecret && (
        <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Set an encryption secret</span>
            <span>
              API keys are encrypted at rest with a built-in default key, which is obfuscation
              rather than protection. Set <code className="font-mono">CREDENTIALS_SECRET</code> to
              a random value.
            </span>
          </div>
        </div>
      )}

      {/* Provider picker */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          Sending Provider
        </h4>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-foreground">Default provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className={INPUT_CLASS}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {descriptor && (
            <span className="text-xs text-muted-foreground">
              {descriptor.summary}{' '}
              <a
                href={descriptor.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Docs
              </a>
            </span>
          )}
        </div>

        {descriptor && !descriptor.httpsOnly && (
          <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              This provider needs outbound SMTP ports, which many hosts (Railway included) block.
              The HTTPS-based providers work everywhere.
            </span>
          </div>
        )}

        <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Each provider authenticates your sending domain separately. Set up SPF, DKIM and DMARC
            for {descriptor?.label ?? 'the provider'} before sending a campaign, or your mail will
            land in spam.
          </span>
        </div>
      </div>

      {/* Credentials, rendered from the provider descriptor */}
      {descriptor && descriptor.fields.length > 0 && (
        <div className="flex flex-col gap-3">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
            {descriptor.label} Credentials
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {descriptor.fields.map(renderField)}
          </div>
        </div>
      )}

      {/* Sender identity */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          Default Sender
        </h4>
        <div className="flex flex-col gap-1.5">
          <input
            type="text"
            value={defaultSender}
            onChange={(e) => setDefaultSender(e.target.value)}
            placeholder='e.g. "Sender Name" <hello@domain.com>'
            className={INPUT_CLASS}
          />
          <span className="text-xs text-muted-foreground">
            Used when a message does not name its own sender. Additional from-addresses are managed
            in the Senders tab.
          </span>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md-s text-xs text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-md-s text-sm font-semibold hover:opacity-90 disabled:opacity-60 cursor-pointer"
        >
          {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isSaving ? 'Saving...' : 'Save sending settings'}
        </button>
      </div>

      {/* Test send — the fastest way to find out a domain is unverified */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          Send a test email
        </h4>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@yourdomain.com"
            className={INPUT_CLASS + ' sm:max-w-xs'}
          />
          <button
            type="button"
            onClick={handleTest}
            disabled={isTesting || !testTo}
            className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-md-s text-sm font-semibold text-foreground hover:bg-muted/40 disabled:opacity-60 cursor-pointer"
          >
            {isTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {isTesting ? 'Sending...' : 'Send test'}
          </button>
        </div>
        <span className="text-xs text-muted-foreground">
          Uses the saved settings, so save any changes first.
        </span>
        {testResult && (
          <div
            className={
              testResult.ok
                ? 'p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent'
                : 'p-3 bg-destructive/10 border border-destructive/20 rounded-md-s text-xs text-destructive font-mono'
            }
          >
            {testResult.message}
          </div>
        )}
      </div>

      {/* Bounce webhook hint */}
      {descriptor && descriptor.id !== 'cloudflare' && descriptor.id !== 'smtp' && (
        <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Bounce tracking</span>
            <span>
              Point {descriptor.label}'s bounce webhook at{' '}
              <code className="font-mono break-all">
                {typeof window !== 'undefined' ? window.location.origin : ''}
                /api/webhooks/email/{descriptor.id}
              </code>{' '}
              so bounced contacts are marked automatically.
            </span>
          </div>
        </div>
      )}
    </form>
  )
}
