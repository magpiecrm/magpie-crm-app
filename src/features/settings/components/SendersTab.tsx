import { useEffect, useState } from 'react'
import { Check, Mail, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { createSenderFn, deleteSenderFn, getSendersFn, updateSenderFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel, SettingsRow } from './SettingsBlock'

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
      showSenderSuccess('Sender added.')
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
      showSenderSuccess('Sender updated.')
    } catch (e: any) {
      setSenderError(e.message || 'Failed to update sender')
    } finally {
      setIsSavingSender(false)
    }
  }

  const handleDeleteSender = async (id: number, name: string) => {
    if (!window.confirm(`Delete the sender "${name}"?`)) return
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
    <div className="flex flex-col gap-4">
      {senderSuccess && <Notice level="success">{senderSuccess}</Notice>}
      {senderError && <Notice level="error">{senderError}</Notice>}

      <SettingsPanel>
        <SettingsBlock title="Senders" description="The names and addresses campaigns are sent from.">
          {isLoadingSenders ? (
            <SettingsEmpty>
              <RefreshCw className="mr-2 inline h-4 w-4 animate-spin text-accent" />
              Loading…
            </SettingsEmpty>
          ) : senders.length === 0 ? (
            <SettingsEmpty>No senders yet. Add one below.</SettingsEmpty>
          ) : (
            <SettingsList>
              {senders.map((sender) => {
                const editing = editingSenderId === sender.id
                return (
                  <SettingsRow
                    key={sender.id}
                    icon={<Mail className="h-4 w-4" />}
                    title={sender.name}
                    detail={sender.email}
                    actions={
                      // While it's being edited, the form below is the row's only controls.
                      editing ? undefined : (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleStartEdit(sender)}
                            aria-label={`Edit ${sender.name}`}
                            title="Edit"
                            leftIcon={<Pencil className="h-4 w-4" />}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteSender(sender.id, sender.name)}
                            aria-label={`Delete ${sender.name}`}
                            title="Delete"
                            className="hover:!bg-destructive/10 hover:!text-destructive"
                            leftIcon={<Trash2 className="h-4 w-4" />}
                          />
                        </>
                      )
                    }
                  >
                    {editing && (
                      <div className="flex flex-col gap-3">
                        <FieldGrid>
                          <Field label="Display name">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Marketing team"
                              className={INPUT_CLASS}
                            />
                          </Field>
                          <Field label="Email address">
                            <input
                              type="email"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              placeholder="hello@yourdomain.com"
                              className={INPUT_CLASS}
                            />
                          </Field>
                        </FieldGrid>
                        <SettingsActions>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleSaveEdit(sender.id)}
                            isLoading={isSavingSender}
                            disabled={!editName.trim() || !editEmail.trim()}
                            leftIcon={<Check className="h-3.5 w-3.5" />}
                          >
                            Save
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={handleCancelEdit}>
                            Cancel
                          </Button>
                        </SettingsActions>
                      </div>
                    )}
                  </SettingsRow>
                )
              })}
            </SettingsList>
          )}
        </SettingsBlock>

        <SettingsBlock title="Add a sender">
          <form onSubmit={handleAddSender} className="flex flex-col gap-3">
            <FieldGrid>
              <Field label="Display name">
                <input
                  type="text"
                  required
                  value={newSenderName}
                  onChange={(e) => setNewSenderName(e.target.value)}
                  placeholder="Marketing team"
                  disabled={isAddingSender}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Email address">
                <input
                  type="email"
                  required
                  value={newSenderEmail}
                  onChange={(e) => setNewSenderEmail(e.target.value)}
                  placeholder="hello@yourdomain.com"
                  disabled={isAddingSender}
                  className={INPUT_CLASS}
                />
              </Field>
            </FieldGrid>
            <SettingsActions>
              <Button
                type="submit"
                isLoading={isAddingSender}
                disabled={!newSenderName.trim() || !newSenderEmail.trim()}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                Add sender
              </Button>
            </SettingsActions>
          </form>
        </SettingsBlock>
      </SettingsPanel>
    </div>
  )
}
