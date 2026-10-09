import { useEffect, useState } from 'react'
import { Eye, EyeOff, RefreshCw, Save, Send } from 'lucide-react'
import {
  getEmailSettingsFn,
  saveEmailSettingsFn,
  sendProviderTestEmailFn,
} from '../../../server/functions'
// Descriptors only — importing the provider registry here would pull nodemailer
// and node:crypto into the client bundle.
import type { ProviderDescriptor, ProviderField } from '../../../server/providers/types'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { Select } from '../../../components/ui/Select'
import { ManagedSending } from './ManagedSending'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsPanel } from './SettingsBlock'

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
  // The host runs sending through its own mail server: this page is just sending domains.
  const [managed, setManaged] = useState(false)

  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [webhooksOn, setWebhooksOn] = useState(true)
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
      setManaged(res.managed)
      setWebhooksOn(res.webhooksOn)
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
      <Field
        key={field.key}
        label={
          <>
            {field.label}
            {field.required && <span className="text-destructive"> *</span>}
          </>
        }
        hint={field.help}
      >
        {field.type === 'select' ? (
          <Select
            value={state.value}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            className={INPUT_CLASS}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        ) : field.type === 'secret' ? (
          <div className="relative flex items-center">
            <input
              type={visibleFields[id] ? 'text' : 'password'}
              value={state.value}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              // Secrets are never sent back to the browser, so a saved value
              // shows as empty. Blank on save means "keep what is stored".
              placeholder={state.isSet ? 'Saved — leave blank to keep' : field.placeholder}
              className={`${INPUT_CLASS} pr-10`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => toggleVisibility(id)}
              aria-label={visibleFields[id] ? 'Hide' : 'Show'}
              className="absolute right-0.5"
              leftIcon={visibleFields[id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            />
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
      </Field>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <SettingsPanel>
          <SettingsBlock title="Sending">
            <SettingsEmpty>
              <RefreshCw className="mr-2 inline h-4 w-4 animate-spin text-accent" />
              Loading…
            </SettingsEmpty>
          </SettingsBlock>
        </SettingsPanel>
      </div>
    )
  }

  if (managed) return <ManagedSending />

  return (
    <div className="flex flex-col gap-4">
      {source === 'env' && (
        <Notice title="Using environment variables">
          No provider has been saved yet, so sending falls back to your <code className="font-mono">SES_*</code>,{' '}
          <code className="font-mono">CLOUDFLARE_*</code> or <code className="font-mono">SMTP_*</code> variables. Saving here overrides them.
        </Notice>
      )}

      {credsUnreadable && (
        <Notice level="error" title="Stored credentials cannot be read">
          The encryption secret changed since they were saved. Enter the credentials again below.
        </Notice>
      )}

      {usingDefaultSecret && (
        <Notice level="warning" title="Set an encryption secret">
          API keys are encrypted at rest with a built-in default key, which is obfuscation rather than protection. Set{' '}
          <code className="font-mono">CREDENTIALS_SECRET</code> to a random value.
        </Notice>
      )}

      {/* One form around every block: the save button sits in the last block it covers. */}
      <form onSubmit={handleSave}>
        <SettingsPanel>
          {/* Provider picker */}
          <SettingsBlock title="Sending provider">
            <FieldGrid>
              <Field label="Default provider">
                <Select value={provider} onChange={(e) => setProvider(e.target.value)} className={INPUT_CLASS}>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FieldGrid>
            {descriptor && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {descriptor.summary}{' '}
                <a href={descriptor.docsUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  Docs
                </a>
              </p>
            )}

            {descriptor && !descriptor.httpsOnly && (
              <Notice level="warning">
                This provider needs outbound SMTP ports, which many hosts (Railway included) block. The HTTPS-based providers work everywhere.
              </Notice>
            )}

            <Notice>
              Each provider authenticates your sending domain separately. Set up SPF, DKIM and DMARC for {descriptor?.label ?? 'the provider'}{' '}
              before sending a campaign, or your mail will land in spam.
            </Notice>
          </SettingsBlock>

          {/* Credentials, rendered from the provider descriptor */}
          {descriptor && descriptor.fields.length > 0 && (
            <SettingsBlock title={`${descriptor.label} credentials`}>
              <FieldGrid>{descriptor.fields.map(renderField)}</FieldGrid>
            </SettingsBlock>
          )}

          {/* Sender identity */}
          <SettingsBlock
            title="Default sender"
            description="Used when a message does not name its own sender. Additional from-addresses are managed on the Sender addresses page."
          >
            <Field label="Name and address">
              <input
                type="text"
                value={defaultSender}
                onChange={(e) => setDefaultSender(e.target.value)}
                placeholder='e.g. "Your name" <hello@domain.com>'
                className={INPUT_CLASS}
              />
            </Field>

            {error && <Notice level="error">{error}</Notice>}
            {success && <Notice level="success">{success}</Notice>}

            <SettingsActions>
              <Button type="submit" isLoading={isSaving} leftIcon={<Save className="h-4 w-4" />}>
                Save sending settings
              </Button>
            </SettingsActions>
          </SettingsBlock>

          {/* Test send — the fastest way to find out a domain is unverified */}
          <SettingsBlock title="Send a test" description="Uses the saved settings, so save any changes first.">
            <FieldGrid>
              <Field label="Send a test email to">
                <input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="you@yourdomain.com"
                  className={INPUT_CLASS}
                />
              </Field>
            </FieldGrid>
            {testResult && (
              <Notice level={testResult.ok ? 'success' : 'error'} className="break-words">
                {testResult.message}
              </Notice>
            )}
            <SettingsActions>
              <Button type="button" onClick={handleTest} isLoading={isTesting} disabled={!testTo} leftIcon={<Send className="h-4 w-4" />}>
                Send a test
              </Button>
            </SettingsActions>
          </SettingsBlock>

          {/* Bounce webhook hint */}
          {descriptor && descriptor.id !== 'cloudflare' && descriptor.id !== 'smtp' && (
            <SettingsBlock
              title="Bounces and spam complaints"
              description={
                webhooksOn
                  ? `Point ${descriptor.label}'s bounce and spam complaint webhooks at this address, so bounced addresses and complaints are taken off your lists automatically.`
                  : undefined
              }
            >
              {webhooksOn ? (
                <code className="rounded-md-s border border-border bg-background px-3 py-2 text-xs text-foreground break-all">
                  {typeof window !== 'undefined' ? window.location.origin : ''}
                  /api/webhooks/email/{descriptor.id}?s=<i>your WEBHOOK_SECRET</i>
                </code>
              ) : (
                <Notice level="warning">
                  Set <code className="font-mono">WEBHOOK_SECRET</code> on this server to turn on bounce and complaint tracking; until then{' '}
                  {descriptor.label}'s webhooks are refused.
                </Notice>
              )}
            </SettingsBlock>
          )}
        </SettingsPanel>
      </form>
    </div>
  )
}
