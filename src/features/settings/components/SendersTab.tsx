import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { createSenderFn, deleteSenderFn, getEmailSettingsFn, getSendersFn, getSendingDomainsFn, mailboxesFn, updateSenderFn } from '../../../server/functions'
import { queryKeys } from '../../../queryKeys'
import { Badge } from '../../../components/ui/Badge'
import { InboxFooter, SenderInbox } from './Mailboxes'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel } from './SettingsBlock'

/** Whether a sender's address is on a domain that's ready to send from (sendingDomains.ts canSendFrom: the domain itself or a subdomain of it). */
function domainReady(email: string, domains: Array<{ domain: string; ready: boolean }>) {
  const domain = email.toLowerCase().split('@')[1] ?? ''
  return domains.some((d) => d.ready && (domain === d.domain || domain.endsWith(`.${d.domain}`)))
}

/**
 * Settings → Mailboxes: every address campaigns can come from, with what it
 * needs before it can be used (its domain ready to send, its inbox connected
 * so replies stop sequences), so one list answers "which of these work?".
 */
export function SendersTab() {
  const sending = useQuery({ queryKey: queryKeys.settings.sending(), queryFn: () => getEmailSettingsFn() })
  const managed = Boolean(sending.data?.success && sending.data.managed)
  const { data: domains } = useQuery({ queryKey: queryKeys.settings.sendingDomains(), queryFn: () => getSendingDomainsFn(), enabled: managed })
  const { data: boxes } = useQuery({ queryKey: queryKeys.sequences.mailboxes(), queryFn: () => mailboxesFn(), refetchInterval: 60_000 })
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

  const connected = senders.filter((sender) => boxes?.some((b) => b.sender_id === sender.id && b.status === 'ok')).length

  return (
    <div className="flex flex-col gap-4">
      {senderSuccess && <Notice level="success">{senderSuccess}</Notice>}
      {senderError && <Notice level="error">{senderError}</Notice>}

      <SettingsPanel>
        <SettingsBlock
          title="Addresses"
          description={
            senders.length > 0 && boxes
              ? `${senders.length} ${senders.length === 1 ? 'address' : 'addresses'}, ${connected} with ${connected === 1 ? 'its' : 'their'} inbox connected. Until an inbox is connected, replies to it have to be marked by hand.`
              : 'The names and addresses campaigns are sent from.'
          }
        >
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
                  <SenderInbox
                    key={sender.id}
                    sender={sender}
                    box={boxes?.find((b) => b.sender_id === sender.id) ?? null}
                    extraBadge={
                      managed && domains && !domainReady(sender.email, domains) ? (
                        <Badge variant="warning" status>
                          Domain not ready
                        </Badge>
                      ) : undefined
                    }
                    extraActions={
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
                    editor={
                      editing ? (
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
                      ) : undefined
                    }
                  />
                )
              })}
            </SettingsList>
          )}
          {senders.length > 0 && <InboxFooter />}
        </SettingsBlock>

        <SettingsBlock title="Add a sender" description="The name and address people see your campaigns come from.">
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
