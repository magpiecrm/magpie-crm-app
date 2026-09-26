import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ExternalLink, RefreshCw, Save, Trash2, Zap } from 'lucide-react'
import { SecretInput } from '../../../components/ui/SecretInput'
import {
  getCopilotSettingsFn,
  saveCopilotSettingsFn,
  testAnthropicKeyFn,
  testOpenAIKeyFn,
} from '../../../server/functions'

type Masked = Awaited<ReturnType<typeof getCopilotSettingsFn>>
type KeyField = 'anthropicApiKey' | 'openaiApiKey'

interface KeySpec {
  field: KeyField
  masked: 'anthropic' | 'openai'
  title: string
  intro: string
  link: { href: string; label: string }
  placeholder: string
  envVar: string
  test: (apiKey?: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

const KEYS: KeySpec[] = [
  {
    field: 'anthropicApiKey',
    masked: 'anthropic',
    title: 'Anthropic API key',
    intro: 'For Claude models. The copilot calls the Anthropic API with this key, and usage is billed to its account.',
    link: { href: 'https://platform.claude.com/settings/keys', label: 'Create a key in the Claude Console' },
    placeholder: 'sk-ant-...',
    envVar: 'ANTHROPIC_API_KEY',
    test: (apiKey) => testAnthropicKeyFn({ data: { apiKey } }),
  },
  {
    field: 'openaiApiKey',
    masked: 'openai',
    title: 'OpenAI API key',
    intro: 'For OpenAI models (GPT-6). The copilot calls the OpenAI API with this key, and usage is billed to its account.',
    link: { href: 'https://platform.openai.com/api-keys', label: 'Create a key on the OpenAI platform' },
    placeholder: 'sk-proj-...',
    envVar: 'OPENAI_API_KEY',
    test: (apiKey) => testOpenAIKeyFn({ data: { apiKey } }),
  },
]

/** One provider's key: enter, test, save or remove it. */
function KeySection({ spec, settings, onSaved }: { spec: KeySpec; settings: Masked | null; onSaved: (next: Masked) => void }) {
  const [key, setKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const current = settings?.[spec.masked]

  const save = async (clear = false) => {
    setIsSaving(true)
    setMessage(null)
    try {
      const next = await saveCopilotSettingsFn({ data: clear ? { clear: [spec.field] } : { [spec.field]: key } })
      onSaved(next)
      setKey('')
      setMessage({ ok: true, text: clear ? 'Key removed.' : 'Saved. The copilot uses this key from its next message.' })
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Failed to save' })
    } finally {
      setIsSaving(false)
    }
  }

  const test = async () => {
    setIsTesting(true)
    setMessage(null)
    try {
      const res = await spec.test(key || undefined)
      setMessage(res.ok ? { ok: true, text: key ? 'The key works. Save to start using it.' : 'The saved key works.' } : { ok: false, text: res.error })
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Test failed' })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (key) save()
      }}
      className="flex flex-col gap-3"
    >
      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
        {spec.title}
      </h4>
      <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
        {spec.intro}{' '}
        <a href={spec.link.href} target="_blank" rel="noreferrer" className="text-accent hover:underline inline-flex items-center gap-0.5">
          {spec.link.label} <ExternalLink className="w-3 h-3" />
        </a>
      </p>

      <div className="flex flex-col gap-1.5 max-w-xl">
        <label htmlFor={spec.field} className="text-xs font-semibold text-foreground">
          API key
        </label>
        <SecretInput
          id={spec.field}
          value={key}
          onChange={(v) => {
            setKey(v)
            setMessage(null)
          }}
          placeholder={current?.isSet ? `Saved (${current.hint}). Enter a new key to replace it` : spec.placeholder}
        />
        <span className="text-xs text-muted-foreground">
          {current?.source === 'db' && `Saved here and stored encrypted (${current.hint}).`}
          {current?.source === 'env' && (
            <>
              Using <code className="font-mono">{spec.envVar}</code> from the environment ({current.hint}). A key saved
              here takes priority.
            </>
          )}
          {current && !current.source && 'No key yet.'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={isSaving || !key}
          className="py-2 px-3 bg-accent hover:bg-accent/95 disabled:opacity-50 text-accent-foreground text-sm font-semibold rounded-md-s flex items-center gap-2 cursor-pointer"
        >
          {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save key
        </button>
        <button
          type="button"
          onClick={test}
          disabled={isTesting || (!key && !current?.isSet)}
          className="py-2 px-3 border border-border bg-card hover:bg-muted disabled:opacity-50 text-sm font-semibold rounded-md-s flex items-center gap-2 cursor-pointer"
        >
          {isTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Test key
        </button>
        {current?.source === 'db' && !key && (
          <button
            type="button"
            onClick={() => save(true)}
            disabled={isSaving}
            className="py-2 px-3 text-sm font-semibold text-destructive hover:bg-destructive/10 rounded-md-s flex items-center gap-2 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            Remove saved key
          </button>
        )}
      </div>

      {message && (
        <div
          className={`flex items-start gap-2 p-3 rounded-md-s text-xs border max-w-xl ${
            message.ok
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              : 'bg-destructive/10 border-destructive/20 text-destructive'
          }`}
        >
          {message.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}
    </form>
  )
}

/**
 * Settings → Copilot: the user's own Anthropic and/or OpenAI API key, which
 * the copilot calls those APIs with. There is deliberately no Claude.ai or
 * ChatGPT sign-in here; see server/copilot/settings.ts.
 */
export function CopilotTab() {
  const [settings, setSettings] = useState<Masked | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    getCopilotSettingsFn().then(setSettings).catch((e) => setLoadError(e?.message || 'Failed to load settings'))
  }, [])

  const noKey = settings && !settings.anthropic.isSet && !settings.openai.isSet

  return (
    <div className="flex flex-col gap-6">
      {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      {settings?.credsUnreadable && (
        <div className="flex items-start gap-2.5 p-3 bg-destructive/10 border border-destructive/20 rounded-md-s text-xs text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>The saved keys can't be read (the encryption secret changed). Enter them again and save.</span>
        </div>
      )}
      <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
        Add a key for Claude, OpenAI, or both, then pick the model in the copilot's chat.
        {noKey && ' The copilot is off until you add one.'}
      </p>

      {KEYS.map((spec) => (
        <KeySection key={spec.field} spec={spec} settings={settings} onSaved={setSettings} />
      ))}

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          Why an API key
        </h4>
        <p className="text-[11px] text-muted-foreground leading-relaxed max-w-2xl">
          Claude.ai and ChatGPT subscriptions are for one person's own use and can't be shared between an app's
          users, and Anthropic's terms don't allow apps to offer Claude.ai sign-in at all. An API key can be used by
          everyone in your team's copy of this app, billed to its owner. The chat's contents (including contact data
          the copilot reads) go to the provider you pick, so list it as a sub-processor in your privacy notice.
        </p>
      </div>
    </div>
  )
}
