import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { Save, Layout, Check, AlertCircle, Edit2, ArrowLeft, Eye, Smile, HelpCircle, ChevronRight, Search, Clock } from 'lucide-react'
import { listsFn, createCampaignFn, getSendersFn, getCampaignFn, updateCampaignFn, getTemplateFn, getEmailSettingsFn } from '../../../server/functions'
import { EmailBuilder } from '../../email-builder/EmailBuilderContainer'
import { PreviewTestModal } from '../../../components/PreviewTestModal'
import { ScheduleDrawer } from './ScheduleDrawer'
import { Button } from '../../../components/ui/Button'
import { Accordion, AccordionItem } from '../../../components/ui/Accordion'
import { Switch } from '../../../components/ui/Switch'
import { TemplatePicker } from '../../templates/components/TemplatePicker'
import { extractDesign } from '../../email-builder/utils/design'
import { Select } from '../../../components/ui/Select'

interface CampaignWizardProps {
  onClose: () => void
  campaignId?: number
  /** Seed a new campaign's body from this saved template. */
  initialTemplateId?: string
}

type SectionKey = 'sender' | 'subject' | 'recipients' | 'design'

const DEFAULT_HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Email Newsletter</title>
</head>
<body style="background-color: #ffffff; margin: 0; padding: 20px 0; font-family: sans-serif;">
  <!-- BLOCKS_DATA: {"blocks":[],"globalStyle":{"bodyWidth":600,"bodyBgColor":"#ffffff","canvasBgColor":"#ffffff","buttonBgColor":"#27272a","buttonTextColor":"#ffffff","buttonRadius":4,"fontFamily":"sans-serif","paddingX":20,"paddingY":20,"lineHeight":1.5}} -->
  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; padding: 20px 20px;">
    <tr>
      <td>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim()

export function CampaignWizard({ onClose, campaignId, initialTemplateId }: CampaignWizardProps) {
  const queryClient = useQueryClient()
  const [activeSection, setActiveSection] = useState<SectionKey | null>(campaignId ? null : 'sender')
  const [showBuilder, setShowBuilder] = useState(false)
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [showScheduleDrawer, setShowScheduleDrawer] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    previewText: '',
    senderName: '',
    senderEmail: '',
    senderId: null as number | null,
    htmlContent: DEFAULT_HTML_TEMPLATE,
    selectedListId: null as number | null,
    unsubscribeEnabled: true,
    trackOpens: true,
  })
  
  const [isEditingName, setIsEditingName] = useState(false)
  const [tempName, setTempName] = useState('')
  const [activeInputForVariable, setActiveInputForVariable] = useState<'subject' | 'preview' | null>(null)
  const [variableSearchQuery, setVariableSearchQuery] = useState('')

  // When the host runs sending, every campaign carries an unsubscribe link.
  const { data: sendingSettings } = useQuery({ queryKey: queryKeys.settings.sending(), queryFn: () => getEmailSettingsFn() })
  const unsubscribeLocked = Boolean(sendingSettings?.success && sendingSettings.managed)

  const { data: listsData } = useQuery({
    queryKey: queryKeys.email.lists(),
    queryFn: () => listsFn(),
  })

  const { data: sendersData } = useQuery({
    queryKey: queryKeys.email.senders(),
    queryFn: () => getSendersFn(),
  })

  const { data: campaignToEdit } = useQuery({
    queryKey: queryKeys.email.campaign(campaignId),
    queryFn: () => getCampaignFn({ data: { id: campaignId! } }),
    enabled: !!campaignId,
  })

  const { data: initialTemplate } = useQuery({
    queryKey: queryKeys.templates.template(initialTemplateId ?? ''),
    queryFn: () => getTemplateFn({ data: { id: initialTemplateId! } }),
    enabled: !!initialTemplateId && !campaignId,
  })

  // Seed once: later refetches of the template must not overwrite edits.
  const seededFromTemplate = useRef(false)
  useEffect(() => {
    if (!initialTemplate || seededFromTemplate.current) return
    seededFromTemplate.current = true
    setFormData(prev => ({ ...prev, htmlContent: initialTemplate.html }))
  }, [initialTemplate])

  /** Swap the body for a template, confirming before discarding a design that has blocks. */
  const applyTemplateHtml = (html: string, name: string) => {
    const hasDesign = (extractDesign(formData.htmlContent)?.blocks.length ?? 0) > 0
    if (hasDesign && !window.confirm(`Replace the current email design with "${name}"?`)) return
    setFormData(prev => ({ ...prev, htmlContent: html }))
  }

  useEffect(() => {
    if (campaignToEdit) {
      const data = {
        name: campaignToEdit.name || '',
        subject: campaignToEdit.subject || '',
        previewText: campaignToEdit.previewText || '',
        senderName: campaignToEdit.sender?.name || '',
        senderEmail: campaignToEdit.sender?.email || '',
        senderId: campaignToEdit.sender?.id || null,
        htmlContent: campaignToEdit.htmlContent || '',
        selectedListId: campaignToEdit.recipients?.listIds?.[0] || null,
        unsubscribeEnabled: campaignToEdit.unsubscribeEnabled !== false,
        trackOpens: campaignToEdit.trackOpens !== false,
      }
      setFormData(data)
      setTempName(campaignToEdit.name || '')
    } else {
      setTempName('New Campaign')
      setFormData(prev => ({ ...prev, name: 'New Campaign', unsubscribeEnabled: true }))
    }
  }, [campaignToEdit])

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) => 
      campaignId 
        ? updateCampaignFn({
            data: {
              id: campaignId,
              name: data.name,
              subject: data.subject,
              previewText: data.previewText,
              sender: data.senderEmail ? { 
                name: data.senderName, 
                email: data.senderEmail,
                id: data.senderId || undefined
              } : undefined,
              htmlContent: data.htmlContent,
              recipients: { listIds: data.selectedListId ? [data.selectedListId] : [] },
              unsubscribeEnabled: data.unsubscribeEnabled,
              trackOpens: data.trackOpens,
            }
          })
        : createCampaignFn({ 
            data: {
              name: data.name,
              subject: data.subject,
              previewText: data.previewText,
              sender: data.senderEmail ? { 
                name: data.senderName, 
                email: data.senderEmail,
                id: data.senderId || undefined
              } : undefined,
              htmlContent: data.htmlContent,
              recipients: { listIds: data.selectedListId ? [data.selectedListId] : [] },
              unsubscribeEnabled: data.unsubscribeEnabled,
              trackOpens: data.trackOpens,
            } 
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.campaigns() })
      alert(`Campaign ${campaignId ? 'updated' : 'created'} successfully!`)
      onClose()
    },
    onError: (err: any) => {
      alert(`Failed to ${campaignId ? 'update' : 'create'} campaign: ${err.message}`)
    }
  })

  const lists = listsData?.lists || []
  const senders = (sendersData?.senders || []).filter((s: any) => s.active !== false)

  // Auto-select first sender if available and none selected
  useEffect(() => {
    if (senders.length > 0 && !formData.senderEmail) {
      setFormData(prev => ({
        ...prev,
        senderName: senders[0].name,
        senderEmail: senders[0].email,
        senderId: senders[0].id
      }))
    }
  }, [senders])

  const selectedList = lists.find((l: any) => l.id === formData.selectedListId)

  // Section validity checks
  const isSenderValid = !!(formData.name && formData.senderEmail)
  const isSubjectValid = !!formData.subject
  const isRecipientsValid = !!formData.selectedListId
  const isDesignValid = !!formData.htmlContent
  const isCampaignSent = campaignToEdit?.status === 'sent'

  const isSaveDisabled = createMutation.isPending || !formData.name || isCampaignSent

  const handleNameSave = () => {
    if (isCampaignSent) return
    setFormData(prev => ({ ...prev, name: tempName || 'Untitled Campaign' }))
    setIsEditingName(false)
  }

  if (showBuilder) {
    return (
      <EmailBuilder
        initialHtml={formData.htmlContent}
        onSave={(html) => {
          if (isCampaignSent) return
          setFormData(prev => ({ ...prev, htmlContent: html }))
          setShowBuilder(false)
        }}
        onClose={() => setShowBuilder(false)}
        campaignName={formData.name || 'Untitled Campaign'}
        campaignSubject={formData.subject}
        campaignSender={{ name: formData.senderName, email: formData.senderEmail }}
        campaignPreviewText={formData.previewText}
        campaignId={campaignId}
      />
    )
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 pb-12 animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 pb-5 border-b border-border">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <Button variant="ghost" size="icon" onClick={onClose} className="border border-border">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-3">
              {isEditingName && !isCampaignSent ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onBlur={handleNameSave}
                    onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
                    className="bg-card border border-border rounded-md px-3 py-1 text-lg font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    autoFocus
                  />
                  <Button onClick={handleNameSave} size="sm">Done</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group cursor-pointer" onClick={() => !isCampaignSent && setIsEditingName(true)}>
                  <h1 className="text-2xl font-bold text-foreground truncate max-w-[280px] sm:max-w-md">
                    {formData.name || 'Untitled Campaign'}
                  </h1>
                  {!isCampaignSent && <Edit2 className="w-5 h-5 text-muted-foreground group-hover:text-accent transition-colors" />}
                </div>
              )}
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                isCampaignSent 
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-accent/15 text-accent'
              }`}>
                {isCampaignSent ? 'Sent' : 'Draft'}
              </span>
            </div>
            <span className="text-sm text-muted-foreground mt-0.5">
              {isCampaignSent 
                ? 'This campaign has already been sent and is read-only' 
                : 'Configure details below to prepare your campaign'
              }
            </span>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <Button
            variant="outline"
            onClick={() => setShowPreviewModal(true)}
            leftIcon={<Eye className="w-4 h-4 text-accent" />}
          >
            Preview & Test
          </Button>
          {campaignId && !isCampaignSent && (
            <Button
              className="px-4"
              onClick={() => setShowScheduleDrawer(true)}
              leftIcon={<Clock className="w-4 h-4" />}
            >
              Schedule
            </Button>
          )}
        </div>
      </div>

      {isCampaignSent && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-200 text-xs rounded-xl flex gap-3 items-center">
          <AlertCircle className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <span className="font-bold block text-sm">Campaign Already Sent</span>
            <span>This campaign is locked and cannot be edited or rescheduled.</span>
          </div>
        </div>
      )}

      {/* Content list of sections */}
      <Accordion>
        
        {/* SENDER SECTION */}
        <AccordionItem
          id="sender"
          title="Sender"
          subtitle={
            isSenderValid 
              ? `${formData.senderName} (${formData.senderEmail})` 
              : 'Choose who is sending this campaign'
          }
          isValid={isSenderValid}
          isOpen={activeSection === 'sender'}
          onToggle={() => setActiveSection(activeSection === 'sender' ? null : 'sender')}
          triggerLabel="Manage sender"
        >
          <div className="space-y-4 pt-1">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Campaign Name (Internal)</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value })
                  setTempName(e.target.value)
                }}
                placeholder="e.g. Q4 Product Updates"
                className="w-full px-4 py-3 bg-muted/40 border border-border rounded-xl text-foreground placeholder-muted-foreground/50 focus:ring-1 focus:ring-accent focus:border-transparent outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Sender Profile</label>
              {senders.length > 0 ? (
                <div className="space-y-3">
                  <Select 
                    className="w-full px-4 py-3 bg-muted/40 border border-border rounded-xl text-foreground focus:ring-1 focus:ring-accent focus:border-transparent outline-none transition-all font-medium"
                    value={formData.senderEmail}
                    onChange={(e) => {
                      const sender = senders.find((s: any) => s.email === e.target.value)
                      if (sender) {
                        setFormData({ 
                          ...formData, 
                          senderEmail: sender.email, 
                          senderName: sender.name,
                          senderId: sender.id
                        })
                      }
                    }}
                  >
                    {senders.map((s: any) => (
                      <option key={s.id} value={s.email} className="bg-card text-foreground">{s.name} ({s.email})</option>
                    ))}
                  </Select>
                  {formData.senderEmail.match(/@(gmail|yahoo|outlook|hotmail|aol|icloud)\./i) && (
                    <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/25 flex gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[10px] text-amber-800 dark:text-amber-200 leading-tight">
                        Using public domains (like Gmail or Outlook) may trigger DMARC policies. 
                        It's highly recommended to use a verified custom domain.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-red-500/10 rounded-xl border border-red-500/25">
                  <p className="text-xs text-red-800 dark:text-red-200">No active verified senders found. Please configure custom senders in local database.</p>
                </div>
              )}
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => setActiveSection(null)} size="sm">
                Done
              </Button>
            </div>
          </div>
        </AccordionItem>

        {/* RECIPIENTS SECTION */}
        <AccordionItem
          id="recipients"
          title="Recipients"
          subtitle={
            isRecipientsValid 
              ? `${selectedList?.name || 'Selected List'} • ${selectedList?.totalContacts || 0} contacts` 
              : 'Choose who will receive this email campaign'
          }
          isValid={isRecipientsValid}
          isOpen={activeSection === 'recipients'}
          onToggle={() => setActiveSection(activeSection === 'recipients' ? null : 'recipients')}
          triggerLabel="Manage recipients"
        >
          <div className="space-y-4 pt-1">
            <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Target Recipient List</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {lists.map((list: any) => (
                <button
                  key={list.id}
                  onClick={() => setFormData({ ...formData, selectedListId: list.id })}
                  className={`p-4 border rounded-xl text-left transition-all hover:border-accent/40 ${
                    formData.selectedListId === list.id 
                      ? 'bg-accent/10 border-accent ring-1 ring-accent' 
                      : 'bg-muted/10 border-border'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <p className={`font-bold text-sm ${formData.selectedListId === list.id ? 'text-accent' : 'text-foreground'}`}>
                        {list.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{list.totalContacts} contacts</p>
                    </div>
                    {formData.selectedListId === list.id && (
                      <div className="bg-accent text-accent-foreground p-0.5 rounded-full">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => setActiveSection(null)} size="sm">
                Done
              </Button>
            </div>
          </div>
        </AccordionItem>

        {/* SUBJECT SECTION */}
        <AccordionItem
          id="subject"
          title="Subject"
          subtitle={
            isSubjectValid ? (
              <div className="space-y-1">
                <div>
                  <span className="font-semibold text-foreground">Subject: </span>
                  <span>{formData.subject}</span>
                </div>
                {formData.previewText && (
                  <div>
                    <span className="font-semibold text-foreground">Preview: </span>
                    <span className="text-muted-foreground">
                      {(() => {
                        const parts = formData.previewText.split(/(\{\{\s*contact\.[A-Za-z0-9_]+\s*\}\})/g)
                        return parts.map((part, index) => {
                          const match = part.match(/\{\{\s*contact\.([A-Za-z0-9_]+)\s*\}\}/i)
                          if (match) {
                            return (
                              <span key={index} className="mx-1 px-1.5 py-0.5 bg-[#fdf6e2] dark:bg-[#78350f]/20 border border-[#f5e3b5] dark:border-[#78350f]/30 rounded font-semibold text-[11px] text-[#b45309] dark:text-[#f59e0b] inline-block leading-tight select-none">
                                {match[1]}
                              </span>
                            )
                          }
                          return <span key={index}>{part}</span>
                        })
                      })()}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              'Set the subject line and preview text that recipients will see in their inbox'
            )
          }
          isValid={isSubjectValid}
          isOpen={activeSection === 'subject'}
          onToggle={() => setActiveSection(activeSection === 'subject' ? null : 'subject')}
          triggerLabel="Edit subject"
        >
          <div className="pt-2 relative">
            <p className="text-xs text-muted-foreground mb-6">Add a subject line for this campaign.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              
              {/* LEFT COLUMN: Inputs and Variable Popups */}
              <div className="space-y-6">
                
                {/* Subject Line Input card */}
                <div className="space-y-1.5 relative">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    Subject line <span className="text-red-500">*</span>
                    <span title="Subject line visible in recipients' inboxes">
                      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-pointer" />
                    </span>
                  </label>
                  <div className="border border-border rounded-xl bg-muted/20 focus-within:ring-1 focus-within:ring-accent overflow-hidden transition-all">
                    <textarea
                      rows={2}
                      value={formData.subject}
                      onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                      placeholder="Is your stack built around functions or just features?"
                      className="w-full px-4 py-3 bg-transparent text-foreground placeholder-muted-foreground/50 border-none outline-none resize-none font-sans text-sm"
                    />
                    <div className="px-3 py-2 border-t border-border/40 bg-muted/10 flex items-center gap-2.5">
                      <button type="button" className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors" title="Add emoji">
                        <Smile className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveInputForVariable(activeInputForVariable === 'subject' ? null : 'subject')}
                        className={`p-1 rounded font-mono font-bold text-xs transition-all ${
                          activeInputForVariable === 'subject' ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                        title="Add dynamic variable"
                      >
                        {"{}"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Preview Text Input card */}
                <div className="space-y-1.5 relative">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    Preview text
                    <span title="The preheader text next to the subject line">
                      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-pointer" />
                    </span>
                  </label>
                  <div className="border border-border rounded-xl bg-muted/20 focus-within:ring-1 focus-within:ring-accent overflow-hidden transition-all">
                    <textarea
                      rows={3}
                      value={formData.previewText}
                      onChange={(e) => setFormData({ ...formData, previewText: e.target.value })}
                      placeholder="e.g. Hey! {{ contact.FIRSTNAME }}. You probably have more tools than you need..."
                      className="w-full px-4 py-3 bg-transparent text-foreground placeholder-muted-foreground/50 border-none outline-none resize-none font-sans text-sm"
                    />
                    <div className="px-3 py-2 border-t border-border/40 bg-muted/10 flex items-center gap-2.5">
                      <button type="button" className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors" title="Add emoji">
                        <Smile className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveInputForVariable(activeInputForVariable === 'preview' ? null : 'preview')}
                        className={`p-1 rounded font-mono font-bold text-xs transition-all ${
                          activeInputForVariable === 'preview' ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                        title="Add dynamic variable"
                      >
                        {"{}"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Variable insertion popup dropdown */}
                {activeInputForVariable && (
                  <div className="border border-border rounded-2xl bg-card shadow-lg p-4 space-y-3 animate-in slide-in-from-top-1 duration-150 relative z-10">
                    <div className="relative">
                      <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Search for a variable"
                        value={variableSearchQuery}
                        onChange={(e) => setVariableSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-muted/40 border border-border rounded-xl text-xs text-foreground focus:ring-1 focus:ring-accent outline-none"
                      />
                    </div>
                    
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between p-2 hover:bg-muted/40 rounded-xl cursor-pointer transition-colors group">
                        <div className="flex items-center gap-2">
                          <span className="p-1 bg-accent/10 rounded-lg text-accent text-xs font-bold font-mono">{"{}"}</span>
                          <div>
                            <p className="text-xs font-bold text-foreground">Contact attributes</p>
                            <p className="text-[10px] text-muted-foreground">Information associated with a contact (e.g. name, email)</p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                      </div>

                      {/* Attribute Selection Panel */}
                      <div className="pl-9 pt-1.5 grid grid-cols-2 gap-1.5 border-t border-border/30 mt-1.5">
                        {['FIRSTNAME', 'LASTNAME', 'EMAIL', 'COMPANY', 'JOB_TITLE']
                          .filter(attr => attr.toLowerCase().includes(variableSearchQuery.toLowerCase()))
                          .map(attr => (
                            <button
                              key={attr}
                              type="button"
                              onClick={() => {
                                const variableStr = `{{ contact.${attr} }}`
                                if (activeInputForVariable === 'subject') {
                                  setFormData(prev => ({ ...prev, subject: prev.subject + variableStr }))
                                } else {
                                  setFormData(prev => ({ ...prev, previewText: prev.previewText + variableStr }))
                                }
                                setActiveInputForVariable(null)
                                setVariableSearchQuery('')
                              }}
                              className="px-2 py-1.5 bg-muted/45 hover:bg-accent/10 border border-border hover:border-accent/30 text-left text-[11px] rounded-lg text-foreground hover:text-accent font-medium font-mono transition-colors truncate"
                            >
                              {attr}
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* RIGHT COLUMN: Phone Mockup / Live Inbox Preview */}
              <div className="flex flex-col items-center">
                
                {/* Phone Shell */}
                <div className="border-[5px] border-slate-300 dark:border-slate-800 rounded-[38px] w-full max-w-[290px] h-[340px] bg-[#f8fafc] dark:bg-slate-900 relative shadow-lg overflow-hidden flex flex-col scale-95 origin-top">
                  
                  {/* Speaker Notch */}
                  <div className="w-20 h-4 bg-slate-300 dark:bg-slate-800 rounded-b-2xl mx-auto absolute top-0 left-1/2 -translate-x-1/2 z-20 flex justify-center items-start">
                    <div className="w-8 h-1 bg-slate-400 dark:bg-slate-700 rounded-full mt-0.5" />
                  </div>

                  {/* Notification/Bar info */}
                  <div className="h-7 bg-white dark:bg-slate-900 px-6 pt-1 flex justify-between items-center text-[9px] font-bold text-muted-foreground select-none shrink-0">
                    <span>9:47</span>
                    <div className="flex items-center gap-1">
                      <span>Inbox</span>
                    </div>
                  </div>

                  {/* Screen Body */}
                  <div className="flex-1 bg-[#f1f5f9] dark:bg-slate-950 overflow-hidden divide-y divide-slate-200/50 dark:divide-slate-800/40">
                    
                    {/* Active Email Row Preview */}
                    <div className="bg-white dark:bg-slate-900 p-3.5 space-y-1">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="font-bold text-slate-800 dark:bg-slate-200">
                          {formData.senderName || 'Your Company'}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-semibold">17:45</span>
                      </div>
                      <div className="text-[11px] font-bold text-slate-900 dark:text-slate-100 line-clamp-1 leading-tight">
                        {formData.subject || 'Is your stack built around functions or just features?'}
                      </div>
                      <div className="text-[10px] text-muted-foreground/85 line-clamp-2 leading-snug">
                        {formData.previewText ? (
                          (() => {
                            const parts = formData.previewText.split(/(\{\{\s*contact\.[A-Za-z0-9_]+\s*\}\})/g)
                            return parts.map((part, index) => {
                              const match = part.match(/\{\{\s*contact\.([A-Za-z0-9_]+)\s*\}\}/i)
                              if (match) {
                                return (
                                  <span key={index} className="mx-0.5 px-1 bg-amber-500/10 border border-amber-500/25 rounded font-semibold font-mono text-[9px] text-amber-700 dark:text-amber-300 inline-block">
                                    {match[1]}
                                  </span>
                                )
                              }
                              return <span key={index}>{part}</span>
                            })
                          })()
                        ) : (
                          'Hey! FIRSTNAME. You probably have more tools than you need and a gap you are filling...'
                        )}
                      </div>
                    </div>

                    {/* Fake email item 2 */}
                    <div className="p-3 bg-white/70 dark:bg-slate-900/60 opacity-60 space-y-1.5">
                      <div className="flex justify-between items-center text-[10px] font-bold text-slate-500">
                        <span>Your Company</span>
                        <span>17:45</span>
                      </div>
                      <div className="h-2 bg-slate-300 dark:bg-slate-800 rounded-sm w-3/4" />
                      <div className="h-1.5 bg-slate-200 dark:bg-slate-800/80 rounded-sm w-5/6" />
                    </div>

                    {/* Fake email item 3 */}
                    <div className="p-3 bg-white/70 dark:bg-slate-900/60 opacity-40 space-y-1.5">
                      <div className="flex justify-between items-center text-[10px] font-bold text-slate-500">
                        <span>Your Company</span>
                        <span>17:45</span>
                      </div>
                      <div className="h-2 bg-slate-300 dark:bg-slate-800 rounded-sm w-2/3" />
                      <div className="h-1.5 bg-slate-200 dark:bg-slate-800/80 rounded-sm w-full" />
                    </div>

                    {/* Fake email item 4 */}
                    <div className="p-3 bg-white/70 dark:bg-slate-900/60 opacity-20 space-y-1.5">
                      <div className="h-2 bg-slate-300 dark:bg-slate-800 rounded-sm w-1/2" />
                    </div>

                  </div>
                </div>

                <p className="text-[9px] text-muted-foreground mt-2 text-center select-none leading-none">
                  Actual preview may vary depending on the email client.
                </p>
              </div>

            </div>

            {/* Cancel and Save Actions */}
            <div className="flex justify-end gap-3 pt-6 border-t border-border/40 mt-5">
              <Button
                variant="ghost"
                onClick={() => setActiveSection(null)}
                size="sm"
              >
                Cancel
              </Button>
              <Button 
                onClick={() => setActiveSection(null)} 
                size="sm"
              >
                Save
              </Button>
            </div>
          </div>
        </AccordionItem>

        {/* DESIGN / CONTENT SECTION */}
        <AccordionItem
          id="design"
          title="Design"
          subtitle={
            isDesignValid 
              ? 'HTML template configured' 
              : 'Design and draft your email message body'
          }
          isValid={isDesignValid}
          isOpen={activeSection === 'design'}
          onToggle={() => setActiveSection(activeSection === 'design' ? null : 'design')}
          triggerLabel="Edit design"
        >
          <div className="space-y-4 pt-1">
            <CampaignSetting
              title="Include Unsubscribe Link"
              description={
                unsubscribeLocked
                  ? 'Always on: every campaign has an unsubscribe link, and mail apps show their own Unsubscribe button.'
                  : 'Add a personalized link at the bottom of the email for recipients to unsubscribe.'
              }
              checked={unsubscribeLocked || formData.unsubscribeEnabled}
              disabled={unsubscribeLocked}
              onChange={(on) => setFormData({ ...formData, unsubscribeEnabled: on })}
            />
            <CampaignSetting
              title="Track opens"
              description="Adds a hidden image that records when each person opens the email. In the UK and EU you need recipients' consent for this: people who signed up and agreed to it, yes; people found through prospect search, no. Clicks, bounces and unsubscribes are recorded either way."
              checked={formData.trackOpens}
              onChange={(on) => setFormData({ ...formData, trackOpens: on })}
            />

            {!isCampaignSent && (
              <div className="space-y-2">
                <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider">Start from a template</label>
                <TemplatePicker onPick={applyTemplateHtml} />
              </div>
            )}

            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-border rounded-xl bg-muted/10 text-center">
              <Layout className="w-8 h-8 text-accent mb-2" />
              <h4 className="font-semibold text-foreground text-sm">Drag & Drop Editor</h4>
              <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
                Design a professional-looking responsive newsletter template visually with our builder.
              </p>
              <Button
                onClick={() => setShowBuilder(true)}
                size="sm"
              >
                Open Design Builder
              </Button>
            </div>
            
            <div className="space-y-2">
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider">Or Edit HTML Source Directly</label>
              <textarea
                value={formData.htmlContent}
                onChange={(e) => setFormData({ ...formData, htmlContent: e.target.value })}
                className="w-full h-24 px-4 py-3 bg-muted/40 border border-border text-foreground rounded-xl font-mono text-xs focus:ring-1 focus:ring-accent focus:border-transparent outline-none transition-all"
                placeholder="<!DOCTYPE html><html><body>...</body></html>"
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={() => setActiveSection(null)} size="sm">
                Done
              </Button>
            </div>
          </div>
        </AccordionItem>

      </Accordion>

      {/* Footer / Actions Bar below the checklist cards */}
      <div className="bg-card border border-border rounded-md-xl px-6 py-5 flex justify-between items-center gap-4 shadow-sm">
        <Button
          variant="ghost"
          onClick={onClose}
          size="sm"
        >
          Cancel Draft
        </Button>
        
        <Button
          onClick={() => createMutation.mutate(formData)}
          disabled={isSaveDisabled}
          isLoading={createMutation.isPending}
          rightIcon={<Save className="w-4.5 h-4.5" />}
        >
          {campaignId ? 'Save Campaign' : 'Create Campaign'}
        </Button>
      </div>

      {/* Preview & Test Modal */}
      <PreviewTestModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        htmlContent={formData.htmlContent}
        campaignSubject={formData.subject}
        campaignSender={{ name: formData.senderName, email: formData.senderEmail }}
        campaignPreviewText={formData.previewText}
      />

      {/* Schedule Campaign Drawer */}
      {campaignId && (
        <ScheduleDrawer
          isOpen={showScheduleDrawer}
          onClose={() => setShowScheduleDrawer(false)}
          campaignId={campaignId}
          campaignData={formData}
          onSendSuccess={onClose}
        />
      )}

    </div>
  )
}

/** One on/off campaign setting: what it does, and its switch. */
function CampaignSetting({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 bg-muted/15 border border-border rounded-xl mb-4">
      <div>
        <h4 className="font-semibold text-foreground text-sm">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  )
}
