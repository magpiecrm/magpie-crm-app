import { useEffect, useState } from 'react'
import { ExternalLink, Save, Trash2, Zap } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Field } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { SecretInput } from '../../../components/ui/SecretInput'
import {
  getCopilotSettingsFn,
  saveCopilotSettingsFn,
  testAnthropicKeyFn,
  testOpenAIKeyFn,
} from '../../../server/functions'
import { SettingsActions, SettingsBlock, SettingsPanel } from './SettingsBlock'

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

  const hint =
    current?.source === 'db' ? (
      `Saved here and stored encrypted (${current.hint}).`
    ) : current?.source === 'env' ? (
      <>
        Using <code className="font-mono">{spec.envVar}</code> from the environment ({current.hint}). A key saved here
        takes priority.
      </>
    ) : current ? (
      'No key yet.'
    ) : undefined

  return (
    <SettingsBlock
      title={spec.title}
      description={
        <p>
          {spec.intro}{' '}
          <a href={spec.link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline">
            {spec.link.label} <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (key) save()
        }}
        className="flex flex-col gap-3"
      >
        {/* Full width, not one grid slot: a key is long, and so is the "saved" placeholder. */}
        <Field label="API key" hint={hint}>
          <SecretInput
            id={spec.field}
            value={key}
            onChange={(v) => {
              setKey(v)
              setMessage(null)
            }}
            placeholder={current?.isSet ? `Saved (${current.hint}). Enter a new key to replace it` : spec.placeholder}
          />
        </Field>

        {message && <Notice level={message.ok ? 'success' : 'error'}>{message.text}</Notice>}

        <SettingsActions>
          <Button type="submit" isLoading={isSaving} disabled={!key} leftIcon={<Save className="h-4 w-4" />}>
            Save key
          </Button>
          <Button type="button" variant="outline" onClick={test} isLoading={isTesting} disabled={!key && !current?.isSet} leftIcon={<Zap className="h-4 w-4" />}>
            Test key
          </Button>
          {current?.source === 'db' && !key && (
            <Button type="button" variant="outline" onClick={() => save(true)} disabled={isSaving} leftIcon={<Trash2 className="h-4 w-4" />}>
              Remove saved key
            </Button>
          )}
        </SettingsActions>
      </form>
    </SettingsBlock>
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
    <div className="flex flex-col gap-4">
      {loadError && <Notice level="error">{loadError}</Notice>}
      {settings?.credsUnreadable && (
        <Notice level="error">The saved keys can't be read (the encryption secret changed). Enter them again and save.</Notice>
      )}
      <Notice level={noKey ? 'warning' : 'info'}>
        Add a key for Claude, OpenAI, or both, then pick the model in the copilot's chat.
        {noKey && ' The copilot is off until you add one.'}
      </Notice>

      <SettingsPanel>
        {KEYS.map((spec) => (
          <KeySection key={spec.field} spec={spec} settings={settings} onSaved={setSettings} />
        ))}

        <SettingsBlock
          title="Why an API key"
          description={
            <p>
              Claude.ai and ChatGPT subscriptions are for one person's own use and can't be shared between an app's
              users, and Anthropic's terms don't allow apps to offer Claude.ai sign-in at all. An API key can be used by
              everyone in your team's copy of this app, billed to its owner.
            </p>
          }
        >
          <Notice>
            The chat's contents (including contact data the copilot reads) go to the provider you pick, so list it as a
            sub-processor in your privacy notice.
          </Notice>
        </SettingsBlock>
      </SettingsPanel>
    </div>
  )
}
