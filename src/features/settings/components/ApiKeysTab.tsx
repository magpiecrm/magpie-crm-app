import { useEffect, useState } from 'react'
import { AlertCircle, Copy, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { createApiKeyFn, deleteApiKeyFn, getApiKeysFn } from '../../../server/functions'
import { SettingsBlock } from './SettingsBlock'

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
        setApiKeyError(res.error || 'Failed to generate API key')
      }
    } catch (e: any) {
      setApiKeyError(e.message || 'Failed to generate API key')
    } finally {
      setIsGeneratingKey(false)
    }
  }

  const handleDeleteApiKey = async (id: string) => {
    if (!window.confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return
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
    <div className="flex flex-col gap-6">
      {/* Generate Key Form */}
      <SettingsBlock title="Generate new key">
      <form onSubmit={handleCreateApiKey} className="flex flex-col gap-3">
        <div className="flex flex-col md:flex-row gap-3 items-end">
          <div className="flex-1 flex flex-col gap-1.5 w-full">
            <label htmlFor="key-name-input" className="text-xs font-semibold text-foreground">Key Name (e.g. Marketing Site)</label>
            <input
              id="key-name-input"
              type="text"
              required
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Enter key name..."
              disabled={isGeneratingKey}
              className="w-full bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={isGeneratingKey || !newKeyName.trim()}
            className="px-4 py-2.5 bg-primary hover:bg-primary/85 disabled:opacity-50 text-primary-foreground text-sm font-semibold rounded-md-s transition-all shadow-md shrink-0 cursor-pointer flex items-center gap-1.5 w-full md:w-auto justify-center"
          >
            {isGeneratingKey ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-accent-foreground" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Generate Key</span>
              </>
            )}
          </button>
        </div>
        {apiKeyError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md-s mt-2">
            {apiKeyError}
          </div>
        )}
      </form>

      {/* Generated Key Alert Box (Show once) */}
      {generatedKey && (
        <div className="p-5 bg-green-500/10 border border-green-500/20 text-green-500 rounded-md-s flex flex-col gap-3 relative">
          <div className="flex items-start gap-2.5 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="font-bold">API Key Generated Successfully!</span>
              <span className="text-xs text-green-500/80">Make sure to copy this key now. For security, we hash it in the database and you will NOT be able to view it again.</span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              readOnly
              value={generatedKey}
              className="flex-1 min-w-0 bg-background border border-green-500/20 text-green-500 font-mono text-xs rounded-md-s px-3 py-2 focus:outline-none select-all"
            />
            <button
              type="button"
              onClick={handleCopyKey}
              className="px-3 py-2 sm:py-0 bg-green-500/20 hover:bg-green-500/30 text-green-500 rounded-md-s text-xs font-semibold transition-all shrink-0 cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copySuccess ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
        </div>
      )}
      </SettingsBlock>

      {/* Active Keys List */}
      <SettingsBlock title="Active keys">
        {isLoadingKeys ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-accent" />
            <span>Loading API keys...</span>
          </div>
        ) : apiKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No active API keys found. Generate one above.</p>
        ) : (
          <div className="border border-border overflow-hidden bg-card">
            {/* Mobile: the four columns do not fit, so each key becomes a
                card. Matches the table/card split used on the lists and
                analytics pages. */}
            <ul className="md:hidden divide-y divide-border/60">
              {apiKeys.map((key) => (
                <li key={key.id} className="p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <span className="text-sm font-semibold text-foreground truncate">{key.name}</span>
                    <span className="font-mono text-xs text-muted-foreground truncate">{key.masked_key}</span>
                    <span className="text-xs text-muted-foreground">
                      Created {new Date(key.created_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteApiKey(key.id)}
                    className="p-1.5 text-destructive hover:bg-destructive/10 hover:border-destructive/20 border border-transparent rounded-md-s transition-all cursor-pointer shrink-0"
                    title="Revoke Key"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
            <table className="hidden md:table w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b border-border font-semibold text-muted-foreground">
                  <th className="p-3">Name</th>
                  <th className="p-3">Masked Key Preview</th>
                  <th className="p-3">Created</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {apiKeys.map((key) => (
                  <tr key={key.id} className="hover:bg-muted/15 transition-colors">
                    <td className="p-3 font-semibold text-foreground">{key.name}</td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{key.masked_key}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {new Date(key.created_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleDeleteApiKey(key.id)}
                        className="p-1.5 text-destructive hover:bg-destructive/10 hover:border-destructive/20 border border-transparent rounded-md-s transition-all cursor-pointer inline-flex items-center justify-center"
                        title="Revoke Key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsBlock>

      {/* Code Integration Example */}
      <SettingsBlock
        title="Integration code snippet"
        description={<p>Submit a <code className="font-mono">POST</code> request to your deployment or localhost to subscribe new contacts:</p>}
      >
        <pre className="bg-background border border-border rounded-md-s p-4 overflow-x-auto text-[11px] text-muted-foreground font-mono leading-relaxed">
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
    </div>
  )
}
