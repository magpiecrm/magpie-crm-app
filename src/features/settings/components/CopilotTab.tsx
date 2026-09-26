import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ExternalLink, RefreshCw, Save, Trash2, Zap } from 'lucide-react'
import { SecretInput } from '../../../components/ui/SecretInput'
import { getCopilotProvidersFn, getCopilotSettingsFn, saveCopilotSettingsFn, testAnthropicKeyFn } from '../../../server/functions'

type Masked = Awaited<ReturnType<typeof getCopilotSettingsFn>>

/**
 * Settings → Copilot: the user's own Anthropic API key, which the copilot's
 * Claude Code CLI runs with. There is deliberately no Claude.ai sign-in here;
 * see server/copilot/settings.ts.
 */
export function CopilotTab() {
  const [settings, setSettings] = useState<Masked | null>(null)
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    getCopilotSettingsFn().then(setSettings).catch((e) => setMessage({ ok: false, text: e?.message || 'Failed to load settings' }))
    getCopilotProvidersFn()
      .then((res) => setCliInstalled(res.providers.some((p) => p.id === 'claude' && p.available)))
      .catch(() => setCliInstalled(null))
  }, [])

  const save = async (clear = false) => {
    setIsSaving(true)
    setMessage(null)
    try {
      const next = await saveCopilotSettingsFn({ data: clear ? { clear: ['anthropicApiKey'] } : { anthropicApiKey: key } })
      setSettings(next)
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
      const res = await testAnthropicKeyFn({ data: { apiKey: key || undefined } })
      setMessage(res.ok ? { ok: true, text: key ? 'The key works. Save to start using it.' : 'The saved key works.' } : { ok: false, text: res.error })
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'Test failed' })
    } finally {
      setIsTesting(false)
    }
  }

  const anthropic = settings?.anthropic

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (key) save()
      }}
      className="flex flex-col gap-6"
    >
      {settings?.credsUnreadable && (
        <div className="flex items-start gap-2.5 p-3 bg-destructive/10 border border-destructive/20 rounded-md-s text-xs text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>The saved key can't be read (the encryption secret changed). Enter it again and save.</span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          Anthropic API key
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          The copilot runs Claude with your own Anthropic API key, and usage is billed to that key's account.{' '}
          <a
            href="https://platform.claude.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline inline-flex items-center gap-0.5"
          >
            Create a key in the Claude Console <ExternalLink className="w-3 h-3" />
          </a>
        </p>

        <div className="flex flex-col gap-1.5 max-w-xl">
          <label htmlFor="anthropic-key" className="text-xs font-semibold text-foreground">
            API key
          </label>
          <SecretInput
            id="anthropic-key"
            value={key}
            onChange={(v) => {
              setKey(v)
              setMessage(null)
            }}
            placeholder={anthropic?.isSet ? `Saved (${anthropic.hint}). Enter a new key to replace it` : 'sk-ant-...'}
          />
          <span className="text-xs text-muted-foreground">
            {anthropic?.source === 'db' && `Saved here and stored encrypted (${anthropic.hint}).`}
            {anthropic?.source === 'env' && (
              <>
                Using <code className="font-mono">ANTHROPIC_API_KEY</code> from the environment ({anthropic.hint}). A key
                saved here takes priority.
              </>
            )}
            {anthropic && !anthropic.source && 'No key yet, so the copilot is off until you add one.'}
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
            disabled={isTesting || (!key && !anthropic?.isSet)}
            className="py-2 px-3 border border-border bg-card hover:bg-muted disabled:opacity-50 text-sm font-semibold rounded-md-s flex items-center gap-2 cursor-pointer"
          >
            {isTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Test key
          </button>
          {anthropic?.source === 'db' && !key && (
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
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          Claude Code on this server
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          {cliInstalled === false ? (
            <span className="text-destructive">
              The <code className="font-mono">claude</code> CLI isn't installed on this server. Install Claude Code
              (see the README) and reload this page.
            </span>
          ) : cliInstalled ? (
            'Installed. It runs with the key above in its own settings folder, so it never uses a Claude.ai login on this machine.'
          ) : (
            'Checking…'
          )}
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed max-w-2xl">
          Why a key rather than signing in with Claude.ai: Anthropic's terms don't allow apps to offer Claude.ai
          sign-in or to share one subscription between an app's users. An API key can be used by everyone in your
          team's copy of this app, billed to its owner.
        </p>
      </div>
    </form>
  )
}
