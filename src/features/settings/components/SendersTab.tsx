import { useEffect, useState } from 'react'
import { AlertCircle, Check, Mail, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { createSenderFn, deleteSenderFn, getSendersFn, updateSenderFn } from '../../../server/functions'
import { SettingsBlock } from './SettingsBlock'

/** Settings → Sender addresses: the names and addresses campaigns are sent from. */
export function SendersTab() {
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

  useEffect(() => {
    fetchSenders()
  }, [])

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

  return (
    <div className="flex flex-col gap-6">
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
      <SettingsBlock title="Current senders">
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
      </SettingsBlock>

      {/* Add New Sender */}
      <SettingsBlock title="Add new sender">
      <form onSubmit={handleAddSender} className="flex flex-col gap-3">
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
      </SettingsBlock>
    </div>
  )
}
