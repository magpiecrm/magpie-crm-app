import { useState, useEffect } from 'react'
import { AlertCircle, ExternalLink, Key, LogOut, RefreshCw, Eye, EyeOff, Save, Trash2, Copy, Plus, Mail, Pencil, Check, UserCheck } from 'lucide-react'
import { checkClaudeStatusFn, logoutClaudeFn, startClaudeLoginFn, submitClaudeCodeFn, getEnvVarsFn, saveEnvVarsFn, getApiKeysFn, createApiKeyFn, deleteApiKeyFn, getSendersFn, createSenderFn, updateSenderFn, deleteSenderFn, getUsersFn, createUserFn, deleteUserFn, checkAuthFn } from '../../../server/functions'
import { EmailSendingTab } from '../../settings/components/EmailSendingTab'
import { ContactFieldsTab } from '../../settings/components/ContactFieldsTab'
import { ProspectingTab } from '../../settings/components/ProspectingTab'

const TABS = ['copilot', 'prospecting', 'env', 'sending', 'api', 'senders', 'users', 'fields'] as const
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


  // Claude CLI Auth Status State
  const [claudeStatus, setClaudeStatus] = useState<any>(null)
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [isSubmittingCode, setIsSubmittingCode] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authSuccess, setAuthSuccess] = useState(false)

  // Environment Variables State
  const [envVars, setEnvVars] = useState<Record<string, string>>({})
  const [isLoadingEnv, setIsLoadingEnv] = useState(false)
  const [isSavingEnv, setIsSavingEnv] = useState(false)
  const [envError, setEnvError] = useState<string | null>(null)
  const [envSuccess, setEnvSuccess] = useState(false)
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({})

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


  const fetchStatus = async () => {
    setIsLoadingStatus(true)
    setAuthError(null)
    setAuthSuccess(false)
    try {
      const res: any = await checkClaudeStatusFn()
      if (res.success) {
        setClaudeStatus(res.status)
      }
    } catch (e: any) {
      console.error(e)
      setAuthError(e.message || 'Failed to fetch status')
    } finally {
      setIsLoadingStatus(false)
    }
  }

  const fetchEnv = async () => {
    setIsLoadingEnv(true)
    setEnvError(null)
    setEnvSuccess(false)
    try {
      const res = await getEnvVarsFn()
      if (res.success && res.vars) {
        setEnvVars(res.vars)
      } else {
        setEnvError(res.error || 'Failed to fetch environment variables')
      }
    } catch (e: any) {
      console.error(e)
      setEnvError(e.message || 'Failed to fetch environment variables')
    } finally {
      setIsLoadingEnv(false)
    }
  }

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
    fetchStatus()
    fetchEnv()
    fetchApiKeys()
    fetchSenders()
    fetchUsers()
    fetchCurrentUser()
  }, [])


  const handleStartLogin = async () => {
    setIsLoggingIn(true)
    setAuthError(null)
    setLoginUrl(null)
    setAuthSuccess(false)
    try {
      const res: any = await startClaudeLoginFn()
      if (res.success && res.url) {
        setLoginUrl(res.url)
        window.open(res.url, '_blank')
      } else {
        setAuthError(res.error || 'Failed to start login flow')
        setIsLoggingIn(false)
      }
    } catch (e: any) {
      setAuthError(e.message || 'An error occurred')
      setIsLoggingIn(false)
    }
  }

  const handleSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!verificationCode.trim()) return
    setIsSubmittingCode(true)
    setAuthError(null)
    try {
      const res: any = await submitClaudeCodeFn({ data: { code: verificationCode } })
      if (res.success) {
        setAuthSuccess(true)
        setIsLoggingIn(false)
        setLoginUrl(null)
        setVerificationCode('')
        await fetchStatus()
      } else {
        setAuthError(res.error || 'Verification failed')
      }
    } catch (e: any) {
      setAuthError(e.message || 'An error occurred')
    } finally {
      setIsSubmittingCode(false)
    }
  }

  const handleLogout = async () => {
    if (!window.confirm('Are you sure you want to log out from the Claude CLI?')) return
    setIsLoadingStatus(true)
    try {
      await logoutClaudeFn()
      await fetchStatus()
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoadingStatus(false)
    }
  }

  const handleSaveEnv = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSavingEnv(true)
    setEnvError(null)
    setEnvSuccess(false)
    try {
      const res = await saveEnvVarsFn({ data: { vars: envVars } })
      if (res.success) {
        setEnvSuccess(true)
        // Refresh values after saving to sync up
        await fetchEnv()
        setTimeout(() => setEnvSuccess(false), 4000)
      } else {
        setEnvError(res.error || 'Failed to save environment variables')
      }
    } catch (e: any) {
      console.error(e)
      setEnvError(e.message || 'Failed to save environment variables')
    } finally {
      setIsSavingEnv(false)
    }
  }

  const handleEnvChange = (key: string, value: string) => {
    setEnvVars(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const toggleFieldVisibility = (key: string) => {
    setVisibleFields(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

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
        <p className="text-muted-foreground">Manage your application integration settings & environment variables.</p>
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
          Copilot Integration
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
          onClick={() => setActiveTab('env')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-all cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'env'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Environment Variables
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
      {activeTab === 'copilot' && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Claude CLI Auth Status</h4>

            {isLoadingStatus ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                <RefreshCw className="w-4 h-4 animate-spin text-accent" />
                <span>Checking authentication status...</span>
              </div>
            ) : claudeStatus ? (
              <div className="p-5 bg-muted/40 border border-border/80 rounded-md-s flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Status:</span>
                  <span className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full ${
                    claudeStatus.loggedIn
                      ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                      : 'bg-destructive/10 text-destructive border border-destructive/20'
                  }`}>
                    {claudeStatus.loggedIn ? 'Authenticated' : 'Not Logged In'}
                  </span>
                </div>

                {claudeStatus.loggedIn && (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                      <span className="text-muted-foreground">Account Email:</span>
                      <span className="font-mono text-foreground font-semibold break-all">{claudeStatus.email}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Subscription:</span>
                      <span className="capitalize text-foreground font-semibold">{claudeStatus.subscriptionType || 'Pro/Max'}</span>
                    </div>

                    <button
                      onClick={handleLogout}
                      className="mt-3 w-full py-2.5 px-3 border border-destructive/20 hover:bg-destructive/10 text-destructive text-sm font-semibold rounded-md-s transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Log Out from Claude CLI</span>
                    </button>
                  </>
                )}

                {!claudeStatus.loggedIn && !isLoggingIn && (
                  <button
                    onClick={handleStartLogin}
                    className="w-full py-2.5 px-3 bg-accent hover:bg-accent/95 text-accent-foreground text-sm font-semibold rounded-md-s transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Key className="w-4 h-4" />
                    <span>Authenticate Claude CLI</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-2">Unable to check status.</div>
            )}
          </div>

          {isLoggingIn && (
            <div className="border border-border/80 p-5 rounded-md-s bg-muted/20 flex flex-col gap-4">
              <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <AlertCircle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-foreground">Sign-in Page Opened</span>
                  <span>An authorization tab has been opened. If not, click below:</span>
                </div>
              </div>

              {loginUrl && (
                <a
                  href={loginUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-accent-secondary/15 hover:bg-accent-secondary/25 text-accent-secondary text-sm font-semibold rounded-md-s border border-accent-secondary/25 transition-all text-center"
                >
                  <span>Open Authorization Link</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}

              <form onSubmit={handleSubmitCode} className="flex flex-col gap-2">
                <label htmlFor="auth-verification-code" className="text-xs font-bold text-foreground/80">
                  Verification Code
                </label>
                <div className="flex gap-2">
                  <input
                    id="auth-verification-code"
                    type="text"
                    required
                    placeholder="Paste Cai OAuth code here..."
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    disabled={isSubmittingCode}
                    className="flex-1 bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!verificationCode.trim() || isSubmittingCode}
                    className="px-4 bg-accent hover:bg-accent/95 disabled:opacity-50 text-accent-foreground rounded-md-s text-sm font-semibold transition-all shrink-0 cursor-pointer"
                  >
                    {isSubmittingCode ? 'Verifying...' : 'Submit'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {authError && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md-s flex items-start gap-2 animate-pulse-custom">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {authSuccess && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-500 text-sm rounded-md-s flex items-start gap-2">
              <RefreshCw className="w-4 h-4 shrink-0 mt-0.5 animate-spin" />
              <span>Successfully authenticated Claude CLI! Status updated.</span>
            </div>
          )}
        </div>
      )}

      {/* Environment Variables Tab Content */}
      {activeTab === 'env' && (
        <form onSubmit={handleSaveEnv} className="flex flex-col gap-6">
          <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">Note on Env updates</span>
              <span>Saving updates the local <code className="font-mono">.env</code> file on disk and live-injects them into the running process in real time. No server reboot needed!</span>
            </div>
          </div>

          {isLoadingEnv ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <RefreshCw className="w-5 h-5 animate-spin text-accent" />
              <span>Loading environment variables...</span>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* 1. SMTP Setup */}
              <div className="flex flex-col gap-3">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">Zoho SMTP Server Configuration</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-foreground">SMTP Host</label>
                    <input
                      type="text"
                      value={envVars.SMTP_HOST || ''}
                      onChange={(e) => handleEnvChange('SMTP_HOST', e.target.value)}
                      placeholder="e.g. smtp.zoho.eu"
                      className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-foreground">SMTP Port</label>
                    <input
                      type="text"
                      value={envVars.SMTP_PORT || ''}
                      onChange={(e) => handleEnvChange('SMTP_PORT', e.target.value)}
                      placeholder="e.g. 465"
                      className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="text-xs font-semibold text-foreground">SMTP Sender Identity</label>
                    <input
                      type="text"
                      value={envVars.SMTP_SENDER || ''}
                      onChange={(e) => handleEnvChange('SMTP_SENDER', e.target.value)}
                      placeholder='e.g. "Sender Name" <hello@domain.com>'
                      className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-foreground">SMTP Username / Email</label>
                    <input
                      type="email"
                      value={envVars.SMTP_USER || ''}
                      onChange={(e) => handleEnvChange('SMTP_USER', e.target.value)}
                      placeholder="hello@domain.com"
                      className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-foreground">SMTP Password</label>
                    <div className="relative flex items-center">
                      <input
                        type={visibleFields.SMTP_PASS ? 'text' : 'password'}
                        value={envVars.SMTP_PASS || ''}
                        onChange={(e) => handleEnvChange('SMTP_PASS', e.target.value)}
                        placeholder="SMTP Passphrase"
                        className="w-full bg-background border border-border rounded-md-s pl-3 pr-10 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        type="button"
                        onClick={() => toggleFieldVisibility('SMTP_PASS')}
                        className="absolute right-2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        {visibleFields.SMTP_PASS ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. APIs & Secrets */}
              <div className="flex flex-col gap-3">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">API Integrations & Security Secrets</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-foreground">Email Tracking Secret</label>
                    <div className="relative flex items-center">
                      <input
                        type={visibleFields.TRACKING_SECRET ? 'text' : 'password'}
                        value={envVars.TRACKING_SECRET || ''}
                        onChange={(e) => handleEnvChange('TRACKING_SECRET', e.target.value)}
                        placeholder="TRACKING_SECRET"
                        className="w-full bg-background border border-border rounded-md-s pl-3 pr-10 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        type="button"
                        onClick={() => toggleFieldVisibility('TRACKING_SECRET')}
                        className="absolute right-2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        {visibleFields.TRACKING_SECRET ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Authentication credentials */}
              <div className="flex flex-col gap-3">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">App Sign-in Credentials</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-foreground">Admin Account Email</label>
                    <input
                      type="email"
                      value={envVars.AUTH_EMAIL || ''}
                      onChange={(e) => handleEnvChange('AUTH_EMAIL', e.target.value)}
                      placeholder="Admin User Email"
                      className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-foreground">Admin Account Password</label>
                    <div className="relative flex items-center">
                      <input
                        type={visibleFields.AUTH_PASSWORD ? 'text' : 'password'}
                        value={envVars.AUTH_PASSWORD || ''}
                        onChange={(e) => handleEnvChange('AUTH_PASSWORD', e.target.value)}
                        placeholder="Admin Passphrase"
                        className="w-full bg-background border border-border rounded-md-s pl-3 pr-10 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      <button
                        type="button"
                        onClick={() => toggleFieldVisibility('AUTH_PASSWORD')}
                        className="absolute right-2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        {visibleFields.AUTH_PASSWORD ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {envError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md-s flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{envError}</span>
                </div>
              )}

              {envSuccess && (
                <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-500 text-sm rounded-md-s flex items-start gap-2">
                  <span>Successfully updated Environment Variables! Changes are live immediately.</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSavingEnv}
                className="w-full md:w-auto md:self-end mt-4 py-2.5 px-6 bg-accent hover:bg-accent/95 disabled:opacity-50 text-accent-foreground text-sm font-semibold rounded-md-s transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSavingEnv ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-accent-foreground" />
                    <span>Saving environment...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Save Environment Configuration</span>
                  </>
                )}
              </button>
            </div>
          )}
        </form>
      )}

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
                className="px-4 py-2.5 bg-accent hover:bg-accent/95 disabled:opacity-50 text-accent-foreground text-sm font-semibold rounded-md-s transition-all shadow-md shrink-0 cursor-pointer flex items-center gap-1.5 w-full md:w-auto justify-center"
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
              <div className="border border-border rounded-md-m overflow-hidden bg-card">
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
                            className="px-3 py-1.5 text-xs font-semibold bg-accent hover:bg-accent/95 disabled:opacity-50 text-accent-foreground rounded-md-s transition-all flex items-center gap-1.5 cursor-pointer"
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
              className="w-full md:w-auto md:self-end px-4 py-2.5 bg-accent hover:bg-accent/95 disabled:opacity-50 text-accent-foreground text-sm font-semibold rounded-md-s transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
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
              <span>Add and delete users who can log in to your email marketing system. Users can access all aspects of the prospecting and email campaigns.</span>
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
              className="w-full md:w-auto md:self-end px-4 py-2.5 bg-accent hover:bg-accent/95 disabled:opacity-50 text-accent-foreground text-sm font-semibold rounded-md-s transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
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

