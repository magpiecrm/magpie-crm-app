import { useState, useEffect } from 'react'
import { AlertCircle, RefreshCw, Trash2, Copy, Plus, Mail, Pencil, Check, UserCheck } from 'lucide-react'
import { getApiKeysFn, createApiKeyFn, deleteApiKeyFn, getSendersFn, createSenderFn, updateSenderFn, deleteSenderFn, getUsersFn, createUserFn, deleteUserFn, checkAuthFn } from '../../../server/functions'
import { EmailSendingTab } from '../../settings/components/EmailSendingTab'
import { ContactFieldsTab } from '../../settings/components/ContactFieldsTab'
import { ProspectingTab } from '../../settings/components/ProspectingTab'
import { CopilotTab } from '../../settings/components/CopilotTab'
import { McpTab } from '../../settings/components/McpTab'
import { ChangePasswordForm } from '../../settings/components/ChangePasswordForm'

const TABS = ['copilot', 'mcp', 'prospecting', 'sending', 'api', 'senders', 'users', 'fields'] as const
export type SettingsTab = (typeof TABS)[number]

export const isSettingsTab = (value: unknown): value is SettingsTab =>
  typeof value === 'string' && (TABS as readonly string[]).includes(value)

export function SettingsPage({ initialTab }: { initialTab?: SettingsTab }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'copilot')
  // Deep links (e.g. the sidebar's "add your key") can land here while the
  // page is already mounted.
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab)
  }, [initialTab])


  // API Keys State
  const [apiKeys, setApiKeys] = useState<any[]>([])
  const [isLoadingKeys, setIsLoadingKeys] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [isGeneratingKey, setIsGeneratingKey] = useState(false)
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)

  // Senders State
  const [senders, setSenders] = useState<any[]>([])
  const [isLoadingSenders, setIsLoadingSenders] = useState(false)
  const [senderError, setSenderError] = useState<string | null>(null)
  const [senderSuccess, setSenderSuccess] = useState<string | null>(null)
  const [newSenderName, setNewSenderName] = useState('')
  const [newSenderEmail, setNewSenderEmail] = useState('')
  const [isAddingSender, setIsAddingSender] = useState(false)
  const [editingSenderId, setEditingSenderId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [isSavingSender, setIsSavingSender] = useState(false)

  // Users State
  const [users, setUsers] = useState<any[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [userError, setUserError] = useState<string | null>(null)
  const [userSuccess, setUserSuccess] = useState<string | null>(null)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [isAddingUser, setIsAddingUser] = useState(false)


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

  const fetchSenders = async () => {
    setIsLoadingSenders(true)
    setSenderError(null)
    try {
      const res = await getSendersFn()
      if (res.senders) {
        setSenders(res.senders)
      }
    } catch (e: any) {
      setSenderError(e.message || 'Failed to load senders')
    } finally {
      setIsLoadingSenders(false)
    }
  }

  const fetchUsers = async () => {
    setIsLoadingUsers(true)
    setUserError(null)
    try {
      const res = await getUsersFn()
      if (res.success && res.users) {
        setUsers(res.users)
      }
    } catch (e: any) {
      setUserError(e.message || 'Failed to load users')
    } finally {
      setIsLoadingUsers(false)
    }
  }

  const fetchCurrentUser = async () => {
    try {
      const res = await checkAuthFn()
      if (res.isAuthenticated && res.email) {
        setCurrentUserEmail(res.email)
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    fetchApiKeys()
    fetchSenders()
    fetchUsers()
    fetchCurrentUser()
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

  // --- Sender Handlers ---
  const showSenderSuccess = (msg: string) => {
    setSenderSuccess(msg)
    setTimeout(() => setSenderSuccess(null), 3500)
  }

  const handleAddSender = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSenderName.trim() || !newSenderEmail.trim()) return
    setIsAddingSender(true)
    setSenderError(null)
    try {
      await createSenderFn({ data: { name: newSenderName.trim(), email: newSenderEmail.trim() } })
      setNewSenderName('')
      setNewSenderEmail('')
      await fetchSenders()
      showSenderSuccess('Sender added successfully!')
    } catch (e: any) {
      setSenderError(e.message || 'Failed to add sender')
    } finally {
      setIsAddingSender(false)
    }
  }

  const handleStartEdit = (sender: any) => {
    setEditingSenderId(sender.id)
    setEditName(sender.name)
    setEditEmail(sender.email)
    setSenderError(null)
  }

  const handleCancelEdit = () => {
    setEditingSenderId(null)
    setEditName('')
    setEditEmail('')
    setSenderError(null)
  }

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim() || !editEmail.trim()) return
    setIsSavingSender(true)
    setSenderError(null)
    try {
      await updateSenderFn({ data: { id, name: editName.trim(), email: editEmail.trim() } })
      setEditingSenderId(null)
      await fetchSenders()
      showSenderSuccess('Sender updated successfully!')
    } catch (e: any) {
      setSenderError(e.message || 'Failed to update sender')
    } finally {
      setIsSavingSender(false)
    }
  }

  const handleDeleteSender = async (id: number, name: string) => {
    if (!window.confirm(`Are you sure you want to delete the sender "${name}"?`)) return
    setSenderError(null)
    try {
      await deleteSenderFn({ data: { id } })
      await fetchSenders()
      showSenderSuccess('Sender deleted.')
    } catch (e: any) {
      setSenderError(e.message || 'Failed to delete sender')
    }
  }

  // --- User Handlers ---
  const showUserSuccess = (msg: string) => {
    setUserSuccess(msg)
    setTimeout(() => setUserSuccess(null), 3500)
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUserEmail.trim() || !newUserPassword.trim()) return
    setIsAddingUser(true)
    setUserError(null)
    try {
      const res = await createUserFn({ data: { email: newUserEmail.trim(), password: newUserPassword.trim() } })
      if (res.success) {
        setNewUserEmail('')
        setNewUserPassword('')
        await fetchUsers()
        showUserSuccess('User added successfully!')
      } else {
        setUserError(res.error || 'Failed to add user')
      }
    } catch (e: any) {
      setUserError(e.message || 'Failed to add user')
    } finally {
      setIsAddingUser(false)
    }
  }

  const handleDeleteUser = async (email: string) => {
    if (!window.confirm(`Are you sure you want to delete the user "${email}"?`)) return
    setUserError(null)
    try {
      const res = await deleteUserFn({ data: { email } })
      if (res.success) {
        await fetchUsers()
        showUserSuccess('User deleted successfully.')
      } else {
        setUserError(res.error || 'Failed to delete user')
      }
    } catch (e: any) {
      setUserError(e.message || 'Failed to delete user')
    }
  }



  return (
    <div className="p-4 lg:p-8 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-display text-foreground mb-2">Settings</h1>
        <p className="text-muted-foreground">Manage integrations, sending, API keys and users.</p>
      </div>

      {/* Tab Selection — scrolls horizontally on narrow screens rather than
          wrapping, so the active underline stays on one line. */}
      <div className="flex border-b border-border overflow-x-auto scrollbar-none -mx-4 px-4 lg:mx-0 lg:px-0">
        <button
          onClick={() => setActiveTab('copilot')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'copilot'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Copilot
        </button>
        <button
          onClick={() => setActiveTab('mcp')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'mcp'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          AI apps (MCP)
        </button>
        <button
          onClick={() => setActiveTab('prospecting')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'prospecting'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Prospecting
        </button>
        <button
          onClick={() => setActiveTab('sending')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'sending'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Email Sending
        </button>
        <button
          onClick={() => setActiveTab('api')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'api'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Public API
        </button>
        <button
          onClick={() => setActiveTab('senders')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'senders'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Senders
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'users'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Users
        </button>
        <button
          onClick={() => setActiveTab('fields')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'fields'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Contact Fields
        </button>
      </div>

      {/* Copilot Tab Content */}
      {activeTab === 'copilot' && <CopilotTab />}
      {activeTab === 'mcp' && <McpTab />}


      {/* Public API Tab Content */}
      {activeTab === 'prospecting' && <ProspectingTab />}

      {activeTab === 'sending' && <EmailSendingTab />}

      {activeTab === 'fields' && <ContactFieldsTab />}

      {activeTab === 'api' && (
        <div className="flex flex-col gap-6">
          <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">Secure API Key Management</span>
              <span>Generate custom API keys to receive subscriber signups. For security, keys are securely hashed (SHA-256) and most characters are masked in the list.</span>
            </div>
          </div>

          {/* Generate Key Form */}
          <form onSubmit={handleCreateApiKey} className="flex flex-col gap-3 p-5 bg-muted/20 border border-border/80 rounded-md-s">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Generate New Key</h4>
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

          {/* Active Keys List */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">Active Keys</h4>
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
          </div>

          {/* Code Integration Example */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">Integration Code Snippet</h4>
            <p className="text-xs text-muted-foreground">Submit a <code className="font-mono">POST</code> request to your deployment or localhost to subscribe new contacts:</p>
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
          </div>
        </div>
      )}

      {/* Senders Tab Content */}
      {activeTab === 'senders' && (
        <div className="flex flex-col gap-6">
          <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
            <UserCheck className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">Sender Management</span>
              <span>Manage the sender identities used in your campaigns. Each sender has a display name and an email address.</span>
            </div>
          </div>

          {/* Success / Error messages */}
          {senderSuccess && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-500 text-sm rounded-md-s flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{senderSuccess}</span>
            </div>
          )}
          {senderError && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md-s flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{senderError}</span>
            </div>
          )}

          {/* Senders List */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">Current Senders</h4>
            {isLoadingSenders ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <RefreshCw className="w-5 h-5 animate-spin text-accent" />
                <span>Loading senders...</span>
              </div>
            ) : senders.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No senders found. Add one below.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {senders.map((sender) => (
                  <div key={sender.id} className="border border-border rounded-md-s bg-muted/20 overflow-hidden">
                    {editingSenderId === sender.id ? (
                      /* Edit Mode */
                      <div className="p-4 flex flex-col gap-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-semibold text-foreground">Display Name</label>
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="e.g. Marketing Team"
                              className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-semibold text-foreground">Email Address</label>
                            <input
                              type="email"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              placeholder="e.g. hello@yourdomain.com"
                              className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground border border-border hover:bg-muted rounded-md-s transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(sender.id)}
                            disabled={isSavingSender || !editName.trim() || !editEmail.trim()}
                            className="px-3 py-1.5 text-xs font-semibold bg-primary hover:bg-primary/85 disabled:opacity-50 text-primary-foreground rounded-md-s transition-all flex items-center gap-1.5 cursor-pointer"
                          >
                            {isSavingSender ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* View Mode */
                      <div className="p-4 flex items-center gap-3">
                        <div className="p-2 bg-accent/10 rounded-md-s text-accent shrink-0">
                          <Mail className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{sender.name}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate">{sender.email}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(sender)}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border rounded-md-s transition-all cursor-pointer"
                            title="Edit sender"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSender(sender.id, sender.name)}
                            className="p-1.5 text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 rounded-md-s transition-all cursor-pointer"
                            title="Delete sender"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add New Sender */}
          <form onSubmit={handleAddSender} className="flex flex-col gap-3 p-5 bg-muted/20 border border-border/80 rounded-md-s">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Add New Sender</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-foreground">Display Name</label>
                <input
                  type="text"
                  required
                  value={newSenderName}
                  onChange={(e) => setNewSenderName(e.target.value)}
                  placeholder="e.g. Marketing Team"
                  disabled={isAddingSender}
                  className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-foreground">Email Address</label>
                <input
                  type="email"
                  required
                  value={newSenderEmail}
                  onChange={(e) => setNewSenderEmail(e.target.value)}
                  placeholder="e.g. hello@yourdomain.com"
                  disabled={isAddingSender}
                  className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isAddingSender || !newSenderName.trim() || !newSenderEmail.trim()}
              className="w-full md:w-auto md:self-end px-4 py-2.5 bg-primary hover:bg-primary/85 disabled:opacity-50 text-primary-foreground text-sm font-semibold rounded-md-s transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isAddingSender ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /><span>Adding...</span></>
              ) : (
                <><Plus className="w-4 h-4" /><span>Add Sender</span></>
              )}
            </button>
          </form>
        </div>
      )}

      {/* Users Tab Content */}
      {activeTab === 'users' && (
        <div className="flex flex-col gap-6">
          <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
            <UserCheck className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">User Account Management</span>
              <span>Add and delete users who can log in to MagpieCRM. Users can access all aspects of the prospecting and email campaigns.</span>
            </div>
          </div>

          {/* Success / Error messages */}
          {userSuccess && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-500 text-sm rounded-md-s flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{userSuccess}</span>
            </div>
          )}
          {userError && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md-s flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{userError}</span>
            </div>
          )}

          {/* Users List */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">Current Users</h4>
            {isLoadingUsers ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <RefreshCw className="w-5 h-5 animate-spin text-accent" />
                <span>Loading users...</span>
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No users found.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {users.map((user) => {
                  const isSelf = currentUserEmail?.toLowerCase() === user.email.toLowerCase()
                  return (
                    <div key={user.email} className="border border-border rounded-md-s bg-muted/20 overflow-hidden">
                      <div className="p-4 flex items-center gap-3">
                        <div className="p-2 bg-accent/10 rounded-md-s text-accent shrink-0">
                          <Mail className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate flex items-center gap-2">
                            {user.email}
                            {isSelf && (
                              <span className="text-[10px] bg-accent/25 text-accent px-2 py-0.5 rounded-full font-normal">
                                You
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(user.email)}
                            disabled={isSelf || users.length <= 1}
                            className={`p-1.5 border border-transparent rounded-md-s transition-all cursor-pointer ${
                              isSelf || users.length <= 1
                                ? 'text-muted-foreground/45 cursor-not-allowed'
                                : 'text-destructive hover:bg-destructive/10 hover:border-destructive/20'
                            }`}
                            title={
                              isSelf
                                ? 'Cannot delete your own account'
                                : users.length <= 1
                                  ? 'Cannot delete the last remaining user'
                                  : 'Delete user'
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <ChangePasswordForm />

          {/* Add New User */}
          <form onSubmit={handleAddUser} className="flex flex-col gap-3 p-5 bg-muted/20 border border-border/80 rounded-md-s">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Add New User</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-foreground">User Email Address</label>
                <input
                  type="email"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="e.g. member@yourdomain.com"
                  disabled={isAddingUser}
                  className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-foreground">Account Password</label>
                <input
                  type="password"
                  required
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  disabled={isAddingUser}
                  className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isAddingUser || !newUserEmail.trim() || !newUserPassword.trim() || newUserPassword.trim().length < 6}
              className="w-full md:w-auto md:self-end px-4 py-2.5 bg-primary hover:bg-primary/85 disabled:opacity-50 text-primary-foreground text-sm font-semibold rounded-md-s transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isAddingUser ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /><span>Adding...</span></>
              ) : (
                <><Plus className="w-4 h-4" /><span>Add User</span></>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

