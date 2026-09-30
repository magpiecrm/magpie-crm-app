import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { getContactDetailsFn, sendIndividualEmailFn, resubscribeContactFn } from '../../../server/functions'
import { 
  ArrowLeft, 
  Mail, 
  Phone, 
  Building2, 
  Briefcase, 
  CheckCircle2, 
  AlertCircle, 
  List,
  BellOff,
  AlertTriangle,
  RefreshCw
} from 'lucide-react'
import { Avatar } from '../../../components/ui/Avatar'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { formatCustomValue } from '../contactFields'
import { ContactSurveysTab } from './ContactSurveysTab'
import { ContactHistoryTab } from './ContactHistoryTab'
import { FollowUpButton, RecordTasks } from '../../sales/components/TaskParts'
interface ContactDetailsProps {
  email: string
  onClose: () => void
}

export function ContactDetails({ email, onClose }: ContactDetailsProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'overview' | 'surveys' | 'history' | 'lists'>('overview')
  const [isResubscribing, setIsResubscribing] = useState(false)
  const [resubError, setResubError] = useState('')
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false)
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [isSendingEmail, setIsSendingEmail] = useState(false)

  const { data: detailsData, isLoading, error } = useQuery({
    queryKey: queryKeys.email.contact(email),
    queryFn: () => getContactDetailsFn({ data: { email } }),
  })

  if (isLoading) {
    return (
      <div className="p-4 lg:p-8 space-y-6 animate-pulse">
        <div className="h-6 w-24 bg-muted rounded" />
        <div className="h-28 bg-muted rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-64 bg-muted rounded-2xl md:col-span-2" />
          <div className="h-64 bg-muted rounded-2xl" />
        </div>
      </div>
    )
  }

  if (error || !detailsData || !detailsData.success) {
    return (
      <div className="p-4 lg:p-8 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
        <h3 className="text-lg font-bold text-foreground">Failed to load contact</h3>
        <p className="text-sm text-muted-foreground">{(detailsData as any)?.error || 'An unexpected error occurred.'}</p>
        <button 
          onClick={onClose}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-xl font-semibold text-sm cursor-pointer"
        >
          Go Back
        </button>
      </div>
    )
  }

  const { contact, lists, campaigns, fieldDefs, surveyResponses, activity } = detailsData
  const firstName = contact.attributes?.FIRSTNAME || ''
  const lastName = contact.attributes?.LASTNAME || ''
  const fullName = `${firstName} ${lastName}`.trim() || contact.email

  // Calculate some realistic stats based on campaigns
  const totalSent = campaigns.length
  const totalOpened = campaigns.filter((c: any) => c.openedAt).length
  const totalClicked = campaigns.filter((c: any) => c.clickedAt).length
  
  const openRate = totalSent > 0 ? (totalOpened / totalSent) * 100 : 0
  const clickRate = totalSent > 0 ? (totalClicked / totalSent) * 100 : 0

  const handleSendEmail = async () => {
    if (!emailSubject || !emailBody) return
    setIsSendingEmail(true)
    try {
      await sendIndividualEmailFn({
        data: {
          email,
          subject: emailSubject,
          htmlContent: emailBody.replace(/\n/g, '<br/>')
        }
      })
      setIsEmailModalOpen(false)
      setEmailSubject('')
      setEmailBody('')
      alert('Email sent successfully!')
    } catch (err) {
      console.error('Failed to send email:', err)
      alert('Failed to send email')
    } finally {
      setIsSendingEmail(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6 animate-in fade-in duration-200">
      {/* Top back button */}
      <div>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors group mb-2 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to contacts
        </button>
      </div>

      {/* Profile Header panel */}
      <div className="bg-card border border-border rounded-2xl p-6 flex flex-col md:flex-row gap-6 items-start md:items-center justify-between shadow-premium relative overflow-hidden">
        <div className="flex items-center gap-4">
          <Avatar name={fullName} size="lg" />
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground tracking-tight">{fullName}</h1>
              {lists.map((l: any) => (
                <span 
                  key={l.id} 
                  className="px-2.5 py-0.5 bg-accent/10 border border-accent/15 text-accent rounded-full text-xs font-semibold"
                >
                  {l.name}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground font-mono">{contact.email}</p>
          </div>
        </div>

        {/* Action utility row */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button className="px-3.5 py-2 border border-border rounded-xl text-xs font-bold text-foreground bg-muted/20 hover:bg-muted/40 transition-colors flex items-center gap-1.5 cursor-pointer">
            <Mail className="w-3.5 h-3.5" /> Note
          </button>
          <button 
            onClick={() => setIsEmailModalOpen(true)}
            className="px-3.5 py-2 border border-border rounded-xl text-xs font-bold text-foreground bg-muted/20 hover:bg-muted/40 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Mail className="w-3.5 h-3.5" /> Email
          </button>
          <button className="px-3.5 py-2 border border-border rounded-xl text-xs font-bold text-foreground bg-muted/20 hover:bg-muted/40 transition-colors flex items-center gap-1.5 cursor-pointer">
            <Phone className="w-3.5 h-3.5" /> Call
          </button>
          <FollowUpButton on={{ contactEmail: contact.email }} name={fullName} />
        </div>
      </div>

      {/* Tabs list navigation */}
      <div className="border-b border-border">
        <div className="flex gap-8 -mb-px">
          {(['overview', 'surveys', 'history', 'lists'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-4 text-sm font-semibold tracking-wide border-b-2 transition-all capitalize cursor-pointer ${
                activeTab === tab
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab contents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          
          {activeTab === 'overview' && (
            <>
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4 border-b border-border pb-2">Tasks</h3>
                <RecordTasks on={{ contactEmail: contact.email }} />
              </div>

              {/* Campaign Stats Overview Grid */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4 border-b border-border pb-2">Email campaigns</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-muted/20 rounded-xl">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-1">Sent</span>
                    <span className="text-3xl font-black text-foreground">{totalSent}</span>
                  </div>
                  <div className="p-4 bg-muted/20 rounded-xl">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-1">Delivered</span>
                    <span className="text-3xl font-black text-foreground">{totalSent > 0 ? '100%' : '0%'}</span>
                  </div>
                  <div className="p-4 bg-muted/20 rounded-xl">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-1">Unique opening</span>
                    <span className="text-3xl font-black text-foreground">{openRate.toFixed(0)}%</span>
                  </div>
                  <div className="p-4 bg-muted/20 rounded-xl">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide block mb-1">Unique clicks</span>
                    <span className="text-3xl font-black text-foreground">{clickRate.toFixed(0)}%</span>
                  </div>
                </div>
              </div>

              {/* History Timeline */}
              <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4 border-b border-border pb-2">Recent history</h3>
                {campaigns.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">
                    No recent campaign activity for this contact.
                  </div>
                ) : (
                  <div className="relative border-l border-border pl-6 space-y-6 my-2">
                    {campaigns.map((c: any, i: number) => (
                      <div key={i} className="relative group">
                        {/* Dot indicator */}
                        <div className="absolute -left-[31px] top-1 bg-accent text-accent-foreground rounded-full p-1 border-4 border-card">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-foreground">{c.campaignName}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Status: <span className="font-semibold text-accent capitalize">{c.status}</span>
                            {c.openedAt && ` • Opened on ${new Date(c.openedAt).toLocaleString()}`}
                            {c.clickedAt && ` • Clicked link on ${new Date(c.clickedAt).toLocaleString()}`}
                          </p>
                          {c.sentAt && (
                            <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">
                              {new Date(c.sentAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'surveys' && <ContactSurveysTab responses={surveyResponses} />}

          {activeTab === 'history' && <ContactHistoryTab activity={activity} />}

          {activeTab === 'lists' && (
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <List className="w-5 h-5 text-accent" />
                <h3 className="font-bold text-foreground">List Memberships</h3>
              </div>
              {lists.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  This contact does not belong to any lists.
                </div>
              ) : (
                <div className="space-y-3">
                  {lists.map((l: any) => (
                    <div key={l.id} className="flex justify-between items-center p-3 bg-muted/20 border border-border rounded-xl">
                      <span className="font-semibold text-sm text-foreground">{l.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">List ID: {l.id}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Sidebar panels Column */}
        <div className="space-y-6">
          
          {/* Channels Panel */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border pb-1">Channels</h4>
            {(() => {
              // This panel used to render every status inside a green
              // "subscribed" treatment, so an opted-out contact looked fine.
              const subscribed = contact.status === 'subscribed'
              const bounced = contact.status === 'bounced'
              const tone = subscribed
                ? { box: 'bg-emerald-500/5 border-emerald-500/15', pill: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" /> }
                : bounced
                  ? { box: 'bg-red-500/5 border-red-500/15', pill: 'bg-red-500/10 text-red-600 border-red-500/20', icon: <AlertTriangle className="w-4 h-4 text-red-500" /> }
                  : { box: 'bg-amber-500/5 border-amber-500/15', pill: 'bg-amber-500/10 text-amber-600 border-amber-500/20', icon: <BellOff className="w-4 h-4 text-amber-500" /> }

              const handleResubscribe = async () => {
                setIsResubscribing(true)
                setResubError('')
                try {
                  const res: any = await resubscribeContactFn({ data: { email: contact.email } })
                  if (!res.success) {
                    setResubError(res.error || 'Failed to resubscribe')
                    return
                  }
                  queryClient.invalidateQueries({ queryKey: queryKeys.email.contact(contact.email) })
                  queryClient.invalidateQueries({ queryKey: queryKeys.email.contacts() })
                } catch (e: any) {
                  setResubError(e?.message || 'Failed to resubscribe')
                } finally {
                  setIsResubscribing(false)
                }
              }

              return (
                <div className={`p-3 border rounded-xl space-y-3 ${tone.box}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {tone.icon}
                      <span className="text-xs font-bold text-foreground">Email campaigns</span>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wider border px-2 py-0.5 rounded-full ${tone.pill}`}>
                      {contact.status}
                    </span>
                  </div>

                  {!subscribed && (
                    <>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {bounced
                          ? 'Mail to this address bounced, so campaigns skip it. Only resubscribe if you know the address is working again.'
                          : 'This contact opted out, so campaigns skip them. Only resubscribe with their permission.'}
                      </p>
                      <button
                        type="button"
                        onClick={handleResubscribe}
                        disabled={isResubscribing}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md-s border border-border bg-background hover:bg-muted disabled:opacity-60 transition-all cursor-pointer"
                      >
                        {isResubscribing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        {isResubscribing ? 'Resubscribing...' : 'Resubscribe'}
                      </button>
                      {resubError && (
                        <p className="text-[11px] text-red-600">{resubError}</p>
                      )}
                    </>
                  )}
                </div>
              )
            })()}
            <div className="flex items-center justify-between p-3 bg-muted/30 border border-border rounded-xl">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">Transactional emails</span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                Active
              </span>
            </div>
          </div>

          {/* Details Information Panel */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border pb-1">Information</h4>
            <div className="space-y-3.5 text-xs">
              <div>
                <span className="text-muted-foreground block font-medium mb-0.5">LASTNAME</span>
                <span className="font-bold text-foreground">{lastName || '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block font-medium mb-0.5">FIRSTNAME</span>
                <span className="font-bold text-foreground">{firstName || '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block font-medium mb-0.5">EMAIL</span>
                <span className="font-mono font-semibold text-foreground">{contact.email}</span>
              </div>
              <div>
                <span className="text-muted-foreground block font-medium mb-0.5">JOB_TITLE</span>
                <span className="font-bold text-foreground">{contact.attributes?.JOB_TITLE || '—'}</span>
              </div>
              <div>
                <span className="text-muted-foreground block font-medium mb-0.5">COMPANY</span>
                <span className="font-bold text-foreground">{contact.attributes?.COMPANY || '—'}</span>
              </div>
              {fieldDefs.map(field => (
                <div key={field.key}>
                  <span className="text-muted-foreground block font-medium mb-0.5">{field.label}</span>
                  <span className="font-bold text-foreground">{formatCustomValue(contact.custom?.[field.key]) || '—'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Companies Panel */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-3">
            <div className="flex justify-between items-center border-b border-border pb-1">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Companies</h4>
              <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="py-4 text-center text-xs text-muted-foreground leading-normal">
              No companies associated with this record
            </div>
            <button className="w-full py-2 bg-muted/30 border border-border text-foreground hover:bg-muted/50 rounded-xl text-xs font-semibold transition-all cursor-pointer">
              Add companies
            </button>
          </div>

          {/* Deals Panel */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-3">
            <div className="flex justify-between items-center border-b border-border pb-1">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Deals</h4>
              <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="py-4 text-center text-xs text-muted-foreground leading-normal">
              No deals associated with this record
            </div>
            <button className="w-full py-2 bg-muted/30 border border-border text-foreground hover:bg-muted/50 rounded-xl text-xs font-semibold transition-all cursor-pointer">
              Add deals
            </button>
          </div>

        </div>

      </div>

      <Dialog
        isOpen={isEmailModalOpen}
        onClose={() => setIsEmailModalOpen(false)}
        title={`Send Email to ${fullName}`}
        className="max-w-xl"
      >
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Subject</label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Email subject"
              className="w-full px-4 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Message</label>
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              placeholder="Type your message here..."
              rows={6}
              className="w-full px-4 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => setIsEmailModalOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSendEmail} 
              disabled={isSendingEmail || !emailSubject || !emailBody}
            >
              {isSendingEmail ? 'Sending...' : 'Send Email'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
