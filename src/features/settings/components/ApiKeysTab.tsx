import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { createApiKeyFn, deleteApiKeyFn, getApiKeysFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { CODE_CLASS, Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel, SettingsRow } from './SettingsBlock'

/** A key or snippet in a box that scrolls sideways, so a long line never widens the column. */

/** Settings → Signup forms and API: keys for POST /api/subscribe. */
export function ApiKeysTab() {
  // API Keys State
  const [apiKeys, setApiKeys] = useState<any[]>([])
  const [isLoadingKeys, setIsLoadingKeys] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [isGeneratingKey, setIsGeneratingKey] = useState(false)
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)

  const fetchApiKeys = async () => {
    setIsLoadingKeys(true)
    try {
      const res = await getApiKeysFn()
      if (res.success && res.keys) {
        setApiKeys(res.keys)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoadingKeys(false)
    }
  }

  useEffect(() => {
    fetchApiKeys()
  }, [])

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyName.trim()) return
    setIsGeneratingKey(true)
    setApiKeyError(null)
    setGeneratedKey(null)
    try {
      const res = await createApiKeyFn({ data: { name: newKeyName } })
      if (res.success && res.rawKey) {
        setGeneratedKey(res.rawKey)
        setNewKeyName('')
        await fetchApiKeys()
      } else {
        setApiKeyError(res.error || 'Failed to create key')
      }
    } catch (e: any) {
      setApiKeyError(e.message || 'Failed to create key')
    } finally {
      setIsGeneratingKey(false)
    }
  }

  const handleDeleteApiKey = async (id: string) => {
    if (!window.confirm("Revoke this key? This can't be undone.")) return
    try {
      const res = await deleteApiKeyFn({ data: { id } })
      if (res.success) {
        await fetchApiKeys()
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleCopyKey = () => {
    if (!generatedKey) return
    navigator.clipboard.writeText(generatedKey)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsPanel>
        <SettingsBlock title="Your keys">
          {isLoadingKeys ? (
            <SettingsEmpty>
              <RefreshCw className="mr-2 inline h-4 w-4 animate-spin text-accent" />
              Loading…
            </SettingsEmpty>
          ) : apiKeys.length === 0 ? (
            <SettingsEmpty>No keys yet. Create one below.</SettingsEmpty>
          ) : (
            <SettingsList>
              {apiKeys.map((key) => (
                <SettingsRow
                  key={key.id}
                  icon={<KeyRound className="h-4 w-4" />}
                  title={key.name}
                  detail={
                    <>
                      <span className="font-mono">{key.masked_key}</span> · Created{' '}
                      {new Date(key.created_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </>
                  }
                  actions={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteApiKey(key.id)}
                      aria-label={`Revoke ${key.name}`}
                      title="Revoke"
                      className="hover:!bg-destructive/10 hover:!text-destructive"
                      leftIcon={<Trash2 className="h-4 w-4" />}
                    />
                  }
                />
              ))}
            </SettingsList>
          )}
        </SettingsBlock>

        <SettingsBlock title="Create a key" description="Name it after where it will be used.">
          <form onSubmit={handleCreateApiKey} className="flex flex-col gap-3">
            <FieldGrid>
              <Field label="Name">
                <input
                  id="key-name-input"
                  type="text"
                  required
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g. Marketing site"
                  disabled={isGeneratingKey}
                  className={INPUT_CLASS}
                />
              </Field>
            </FieldGrid>
            {apiKeyError && <Notice level="error">{apiKeyError}</Notice>}
            {/* Shown once: only its hash is stored. */}
            {generatedKey && (
              <Notice
                level="success"
                title="Copy this key now"
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyKey}
                    leftIcon={copySuccess ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  >
                    {copySuccess ? 'Copied' : 'Copy'}
                  </Button>
                }
              >
                <div className="flex flex-col gap-2">
                  <p>Only a hash of it is stored, so you won't be able to see it again.</p>
                  <code className={`${CODE_CLASS} block select-all whitespace-nowrap`}>{generatedKey}</code>
                </div>
              </Notice>
            )}
            <SettingsActions>
              <Button type="submit" isLoading={isGeneratingKey} disabled={!newKeyName.trim()} leftIcon={<Plus className="h-4 w-4" />}>
                Create key
              </Button>
            </SettingsActions>
          </form>
        </SettingsBlock>

        <SettingsBlock
          title="Example request"
          description={
            <p>
              Send a <code className="font-mono">POST</code> request to your deployment or localhost to subscribe new contacts.
            </p>
          }
        >
          <pre className={`${CODE_CLASS} whitespace-pre`}>
{`curl -X POST http://localhost:3000/api/subscribe \\
-H "Content-Type: application/json" \\
-H "X-API-Key: YOUR_API_KEY_HERE" \\
-d '{
  "email": "subscriber@domain.com",
  "first_name": "John",
  "last_name": "Doe",
  "company": "Company Inc"
}'`}
          </pre>
        </SettingsBlock>
      </SettingsPanel>
    </div>
  )
}
