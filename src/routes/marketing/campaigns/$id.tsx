import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { useState } from 'react'
import {
  getCampaignActivityFn,
  getCampaignFn,
  listsFn,
  sendCampaignFn,
  unscheduleCampaignFn,
} from '../../../server/functions'
import {
  ArrowLeft,
  Mail,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Send,
  CalendarClock,
  FilePen,
} from 'lucide-react'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import { HeldBackBanner } from '../../../features/campaigns/components/HeldBackBanner'
import {
  ClicksTab,
  DeliverabilityTab,
  OpensTab,
  UnsubscribesTab,
} from '../../../features/campaigns/components/CampaignResultTabs'
import { RECIPIENT_EXPORT_COLUMNS, campaignTotals, percent } from '../../../features/campaigns/results'

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const Route = createFileRoute('/marketing/campaigns/$id')({
  component: CampaignDetailPage,
})

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'deliverability', label: 'Deliverability' },
  { id: 'opens', label: 'Opens' },
  { id: 'clicks', label: 'Clicks' },
  { id: 'unsubscribes', label: 'Unsubscribes' },
] as const

function CampaignDetailPage() {
  const { id } = Route.useParams()
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['id']>('overview')

  const { data: campaign, isLoading: isLoadingCampaign } = useQuery({
    queryKey: queryKeys.email.campaign(id),
    queryFn: () => getCampaignFn({ data: { id: parseInt(id) } }),
    // Results keep arriving after the send; refresh them while the page is open.
    refetchInterval: (q) => (q.state.data?.status === 'sent' || q.state.data?.status === 'sending' ? 30_000 : false),
  })
  const hasResults = campaign?.status === 'sent' || campaign?.status === 'suspended'

  const { data: activity } = useQuery({
    queryKey: queryKeys.email.campaignActivity(id),
    queryFn: () => getCampaignActivityFn({ data: { id: parseInt(id) } }),
    enabled: hasResults,
    refetchInterval: campaign?.status === 'sent' ? 30_000 : false,
  })

  const { data: listsData } = useQuery({
    queryKey: queryKeys.email.lists(),
    queryFn: () => listsFn(),
  })

  // A scheduled campaign sends on its own; these send it now or take it off the schedule.
  const queryClient = useQueryClient()
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.email.campaign(id) })
    queryClient.invalidateQueries({ queryKey: queryKeys.email.campaigns() })
  }
  const sendNow = useMutation({ mutationFn: () => sendCampaignFn({ data: { id: parseInt(id) } }), onSettled: refresh })
  const unschedule = useMutation({ mutationFn: () => unscheduleCampaignFn({ data: { id: parseInt(id) } }), onSettled: refresh })

  if (isLoadingCampaign) {
    return (
      <div className="p-4 lg:p-8 space-y-6">
        <div className="h-6 w-24 bg-muted animate-pulse rounded" />
        <div className="h-24 bg-muted animate-pulse rounded-xl" />
        <div className="h-10 w-96 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-xl" />
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="p-4 lg:p-8 text-center text-muted-foreground">
        Campaign not found.
      </div>
    )
  }

  const isSent = campaign.status === 'sent'
  const isSuspended = campaign.status === 'suspended'
  const isScheduled = campaign.status === 'scheduled' && Boolean(campaign.scheduledAt)
  // Part-sent: the daily sending limit was reached, and the rest follow from `scheduledAt`.
  const pacing = isScheduled ? campaign.dailyPacing : null
  const isSending = campaign.status === 'sending'
  const totals = campaignTotals(campaign.statistics?.globalStats)
  const formattedDate = when(campaign.sentAt || campaign.createdAt)
  const tracksOpens = campaign.trackOpens !== false
  const tabProps = { totals, activity, sentAt: campaign.sentAt, hasResults, tracksOpens }

  const recipientLists = (campaign.recipients?.listIds || []).map((listId: number) => {
    const found = listsData?.lists?.find((l: any) => l.id === listId)
    return { id: listId, name: found ? found.name : `List #${listId}` }
  })

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto min-h-[100dvh]">
      {/* Back button & Breadcrumb */}
      <div className="mb-6">
        <Link
          to="/marketing/campaigns"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors group mb-4"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to campaigns
        </Link>
      </div>

      {/* Header Info Panel */}
      <div className="bg-card border border-border rounded-2xl p-6 mb-8 flex flex-col md:flex-row gap-6 items-start md:items-center justify-between shadow-premium relative">
        <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center flex-1 min-w-0">
          {/* Scaled iframe thumbnail */}
          <div className="w-[150px] h-[112px] border border-border rounded-xl overflow-hidden bg-white shadow-sm shrink-0 flex items-center justify-center relative group">
            {campaign.htmlContent ? (
              <iframe 
                sandbox="allow-same-origin"
                srcDoc={campaign.htmlContent}
                className="w-[800px] h-[600px] border-0 select-none pointer-events-none scale-[0.1875] origin-top-left absolute top-0 left-0"
                title="Thumbnail"
              />

            ) : (
              <div className="flex items-center justify-center w-full h-full bg-muted/40 text-muted-foreground">
                <Mail className="w-8 h-8 opacity-40" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-200" />
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground tracking-tight truncate max-w-xl">
                {campaign.name}
              </h1>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                isSent ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' : 
                isSuspended ? 'bg-red-500/10 text-red-600 border border-red-500/20' : 
                'bg-muted text-muted-foreground border border-border'
              }`}>
                {campaign.status}
              </span>
            </div>

            <div className="text-xs text-muted-foreground font-medium flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>#{campaign.id}</span>
              <span>•</span>
              <span>
                {isSent
                  ? `Sent on ${formattedDate}`
                  : isScheduled
                    ? pacing
                      ? `Sending over several days: ${pacing.sent} sent, ${pacing.left} to go`
                      : `Scheduled for ${when(campaign.scheduledAt!)}`
                    : isSending
                      ? 'Sending now'
                      : `Created on ${formattedDate}`}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-1.5 pt-1.5 border-t border-border/60 text-xs">
              <div>
                <span className="text-muted-foreground block">Subject</span>
                <span className="font-semibold text-foreground truncate block" title={campaign.subject}>
                  {campaign.subject || '(No Subject)'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">From</span>
                <span className="font-semibold text-foreground truncate block" title={`${campaign.sender?.name} <${campaign.sender?.email}>`}>
                  {campaign.sender?.name ? `${campaign.sender.name} <${campaign.sender.email}>` : campaign.sender?.email || '-'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Reply to</span>
                <span className="font-semibold text-foreground truncate block" title={campaign.replyTo || campaign.sender?.email}>
                  {campaign.replyTo || campaign.sender?.email || '-'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Everyone it went to and what they did, as a spreadsheet. */}
        {hasResults && activity && activity.recipients.length > 0 && (
          <div className="shrink-0 self-stretch md:self-auto border-t md:border-t-0 border-border/60 pt-4 md:pt-0">
            <ExportMenu
              filename={`campaign_${campaign.name}_results`}
              sheetName="Recipients"
              rows={activity.recipients}
              columns={RECIPIENT_EXPORT_COLUMNS}
              label="Export results"
            />
          </div>
        )}
      </div>

      {/* Not sent yet: when it will go, and what can be done about it. */}
      {!isSent && !isSuspended && (
        <div className={`mb-6 rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${isScheduled ? 'border-accent/30 bg-accent/5' : 'border-border bg-muted/30'}`}>
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {isSending ? <Loader2 className="w-5 h-5 text-accent animate-spin shrink-0 mt-0.5" /> : isScheduled ? <CalendarClock className="w-5 h-5 text-accent shrink-0 mt-0.5" /> : <FilePen className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {isSending
                  ? 'Sending now'
                  : isScheduled
                    ? pacing
                      ? `${pacing.sent} sent, ${pacing.left} to go: the next ones go out ${when(campaign.scheduledAt!)}`
                      : `Scheduled for ${when(campaign.scheduledAt!)}`
                    : 'Not sent yet'}
              </p>
              <p className="text-xs text-muted-foreground">
                {isSending
                  ? 'Results appear here as soon as it has gone out.'
                  : isScheduled
                    ? pacing
                      ? 'Your daily sending limit spreads this campaign over several days. It carries on by itself; Settings → Sending shows the limit and when it goes up.'
                      : 'It sends on its own at that time. Results appear here once it has gone out.'
                    : 'This campaign is a draft. Send it, or schedule it from the editor.'}
              </p>
              {(sendNow.error || unschedule.error) && (
                <p className="text-xs text-destructive mt-1">{((sendNow.error || unschedule.error) as Error).message}</p>
              )}
            </div>
          </div>
          {isScheduled && (
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => unschedule.mutate()}
                disabled={unschedule.isPending || sendNow.isPending}
                className="px-3 py-2 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-50"
              >
                {unschedule.isPending ? 'Cancelling…' : 'Cancel schedule'}
              </button>
              <button
                onClick={() => {
                  if (confirm('Send this campaign now instead of at its scheduled time?')) sendNow.mutate()
                }}
                disabled={sendNow.isPending || unschedule.isPending}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/85 disabled:opacity-50"
              >
                {sendNow.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send now
              </button>
            </div>
          )}
        </div>
      )}

      {isSent && campaign.guessHold && <HeldBackBanner campaignId={campaign.id} hold={campaign.guessHold} />}

      {/* Tabs Menu */}
      <div className="border-b border-border mb-8">
        <div className="flex gap-8 -mb-px overflow-x-auto scrollbar-none">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-4 text-sm font-semibold tracking-wide border-b-2 transition-all shrink-0 ${
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs Content */}
      <div className="space-y-8 animate-in fade-in duration-300">
        
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Campaign Performance Grid */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold text-foreground">Campaign performance</h2>
                {isSent && <span className="text-xs text-muted-foreground">Updates every 30 seconds</span>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Delivered */}
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Delivered</span>
                      <span className="text-3xl font-extrabold text-foreground">{hasResults ? totals.delivered.toLocaleString() : '-'}</span>
                    </div>
                    <button onClick={() => setActiveTab('deliverability')} className="text-xs font-bold text-accent hover:underline flex items-center gap-1">
                      View <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="pt-3 border-t border-border/60">
                    <span className="text-[11px] text-muted-foreground block">Delivery rate</span>
                    <span className="text-sm font-bold text-foreground">{hasResults ? percent(totals.delivered, totals.sent) : '-'}</span>
                  </div>
                </div>

                {/* Opens */}
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Opens</span>
                      <span className="text-3xl font-extrabold text-foreground">{!tracksOpens ? 'Off' : hasResults ? totals.opened.toLocaleString() : '-'}</span>
                    </div>
                    <button onClick={() => setActiveTab('opens')} className="text-xs font-bold text-accent hover:underline flex items-center gap-1">
                      View <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="pt-3 border-t border-border/60">
                    <span className="text-[11px] text-muted-foreground block">Open rate</span>
                    <span className="text-sm font-bold text-foreground">{!tracksOpens ? 'Not tracked' : hasResults ? percent(totals.opened, totals.delivered) : '-'}</span>
                  </div>
                </div>

                {/* Clicks */}
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Clicks</span>
                      <span className="text-3xl font-extrabold text-foreground">{hasResults ? totals.clicked.toLocaleString() : '-'}</span>
                    </div>
                    <button onClick={() => setActiveTab('clicks')} className="text-xs font-bold text-accent hover:underline flex items-center gap-1">
                      View <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="pt-3 border-t border-border/60">
                    <span className="text-[11px] text-muted-foreground block">Click-through rate</span>
                    <span className="text-sm font-bold text-foreground">{hasResults ? percent(totals.clicked, totals.delivered) : '-'}</span>
                  </div>
                </div>

                {/* Unsubscribes */}
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Unsubscribes</span>
                      <span className="text-3xl font-extrabold text-foreground">{hasResults ? totals.unsubscribed.toLocaleString() : '-'}</span>
                    </div>
                    <button onClick={() => setActiveTab('unsubscribes')} className="text-xs font-bold text-accent hover:underline flex items-center gap-1">
                      View <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="pt-3 border-t border-border/60">
                    <span className="text-[11px] text-muted-foreground block">Unsubscribe rate</span>
                    <span className="text-sm font-bold text-foreground">{hasResults ? percent(totals.unsubscribed, totals.delivered) : '-'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Campaign Audience Section */}
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-foreground">Campaign audience</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Conditions applied */}
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-3">Conditions applied</span>
                  <div className="space-y-2">
                    {['Only subscribed contacts', "Skips anyone who asked not to be contacted", 'Never sends to the same person twice'].map((c) => (
                      <div key={c} className="flex items-center gap-3 py-2 px-3 bg-muted/40 rounded-lg border border-border/60">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                        <span className="text-sm font-medium text-foreground">{c}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Included segments */}
                <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Included lists / segments</span>
                  <div className="space-y-2">
                    {recipientLists.length === 0 ? (
                      <span className="text-sm text-muted-foreground">No lists specified.</span>
                    ) : (
                      recipientLists.map((list: { id: number; name: string }) => (
                        <div key={list.id} className="flex justify-between items-center py-2 px-3 bg-muted/40 rounded-lg border border-border/60">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">#{list.id}</span>
                            <span className="text-sm font-semibold text-foreground">{list.name}</span>
                          </div>
                          <Link 
                            to="/marketing/lists/$listId" 
                            params={{ listId: list.id.toString() }}
                            className="text-xs font-bold text-accent hover:underline flex items-center gap-1"
                          >
                            View list <ExternalLink className="w-3 h-3" />
                          </Link>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-foreground">Timeline</h2>
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                <div className="relative border-l border-border pl-6 space-y-6">
                  {[
                    campaign.sentAt && { icon: Mail, strong: true, title: 'Sent', text: `Went out to ${totals.sent.toLocaleString()} recipient${totals.sent === 1 ? '' : 's'}.`, at: campaign.sentAt },
                    campaign.scheduledAt && {
                      icon: Clock,
                      strong: !campaign.sentAt,
                      title: isSent ? 'Was scheduled for' : 'Scheduled for',
                      text: isSent ? 'Its scheduled send time.' : 'It sends on its own at this time.',
                      at: campaign.scheduledAt,
                    },
                    campaign.createdAt && { icon: FilePen, strong: false, title: 'Created', text: 'The campaign was created as a draft.', at: campaign.createdAt },
                  ]
                    .filter((e): e is { icon: typeof Mail; strong: boolean; title: string; text: string; at: string } => Boolean(e))
                    .map((e) => (
                      <div key={e.title} className="relative">
                        <div className={`absolute -left-[31px] top-0 rounded-full p-1 border-4 border-card ${e.strong ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>
                          <e.icon className="w-3 h-3" />
                        </div>
                        <p className="text-sm font-bold text-foreground">{e.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{e.text}</p>
                        <p className="text-[10px] text-muted-foreground/60 font-mono mt-1">{when(e.at)}</p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'deliverability' && <DeliverabilityTab {...tabProps} />}
        {activeTab === 'opens' && <OpensTab {...tabProps} />}
        {activeTab === 'clicks' && <ClicksTab {...tabProps} />}
        {activeTab === 'unsubscribes' && <UnsubscribesTab {...tabProps} />}
      </div>
    </div>
  )
}
