import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { Plus, Play, Edit2, Copy, Loader2, Trash2 } from 'lucide-react'

import { useState } from 'react'
import { campaignsFn, sendCampaignFn, deleteCampaignFn, duplicateCampaignFn } from '../../../server/functions'
import { CampaignWizard } from '../../../features/campaigns/components/CampaignWizard'
import { Pagination } from '../../../components/ui/Pagination'

export const Route = createFileRoute('/marketing/campaigns/')({
  // `?template=<id>` opens the wizard on a new campaign seeded from that saved template.
  validateSearch: (search: Record<string, unknown>): { template?: string } =>
    typeof search.template === 'string' ? { template: search.template } : {},
  component: CampaignsPage,
})

function CampaignCard({ campaign, onEdit }: { campaign: any, onEdit: (id: number) => void }) {
  const queryClient = useQueryClient()
  const [isChecked, setIsChecked] = useState(false)

  const sendMutation = useMutation({
    mutationFn: (id: number) => sendCampaignFn({ data: { id } }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.campaigns() })
      // Report the real recipient count rather than a blanket success message.
      const n = res?.sentCount
      alert(
        typeof n === 'number'
          ? `Campaign sent to ${n} recipient${n === 1 ? '' : 's'}.`
          : 'Campaign sent successfully!'
      )
    },
    onError: (err: any) => {
      alert(err?.message || 'Failed to send campaign')
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteCampaignFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.campaigns() })
      alert('Campaign deleted successfully!')
    },
    onError: (err: any) => {
      alert(`Failed to delete campaign: ${err.message}`)
    }
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: number) => duplicateCampaignFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.campaigns() })
      alert('Campaign duplicated successfully!')
    },
    onError: (err: any) => {
      alert(`Failed to duplicate campaign: ${err.message}`)
    }
  })

  const isSent = campaign.status === 'sent'
  const isSuspended = campaign.status === 'suspended'
  const showMetrics = isSent || isSuspended

  // Calculate metrics
  const globalStats = campaign.statistics?.globalStats || {}
  const campaignStatsArray = campaign.statistics?.campaignStats || []

  let cSent = globalStats.sent || 0
  let cDelivered = globalStats.delivered || 0
  let cOpened = globalStats.uniqueViews || globalStats.viewed || 0
  let cClicked = globalStats.uniqueClicks || globalStats.clickers || 0
  let cUnsubscribed = globalStats.unsubscriptions || 0
  let cBounces = (globalStats.softBounces || 0) + (globalStats.hardBounces || 0)

  if (cSent === 0 && campaignStatsArray.length > 0) {
    cSent = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.sent || 0), 0)
    cDelivered = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.delivered || 0), 0)
    cOpened = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.uniqueViews || cs.viewed || 0), 0)
    cClicked = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.uniqueClicks || cs.clickers || 0), 0)
    cUnsubscribed = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.unsubscriptions || 0), 0)
    cBounces = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.softBounces || 0) + (cs.hardBounces || 0), 0)
  }

  if (cDelivered === 0 && cSent > 0) {
    cDelivered = cSent - cBounces
    if (cDelivered < 0) cDelivered = 0
  }

  const campaignOpenRate = cDelivered > 0 ? (cOpened / cDelivered) * 100 : 0
  const campaignClickRate = cDelivered > 0 ? (cClicked / cDelivered) * 100 : 0
  const campaignUnsubRate = cDelivered > 0 ? (cUnsubscribed / cDelivered) * 100 : 0

  // Format dates
  const dateStr = campaign.sentDate || campaign.createdAt
  const formattedDate = dateStr
    ? new Date(dateStr).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-'

  return (
    <div className="bg-card border border-border rounded-md-xl p-4 sm:p-5 mb-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 hover:border-accent/40 hover:shadow-premium transition-all duration-200">
      {/* Left Details Panel */}
      <div className="flex items-center gap-4 flex-1 min-w-0 xl:pr-4">
        <input 
          type="checkbox" 
          checked={isChecked}
          onChange={(e) => setIsChecked(e.target.checked)}
          className="w-4 h-4 rounded border-border text-accent focus:ring-accent cursor-pointer accent-accent" 
        />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Link 
              to="/marketing/campaigns/$id" 
              params={{ id: campaign.id.toString() }}
              className="font-bold text-foreground hover:text-accent transition-colors text-base truncate block max-w-full sm:max-w-md"
            >
              {campaign.name}
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${
                isSent ? 'bg-emerald-500' : isSuspended ? 'bg-red-500' : 'bg-muted-foreground/60'
              }`} />
              <span className={`capitalize font-medium text-foreground`}>{campaign.status}</span>
            </div>
            
            <span>•</span>
            
            <span>
              {isSent 
                ? `Sent on ${formattedDate}` 
                : `Last edited ${formattedDate}`
              }
            </span>
          </div>

          <div className="text-[11px] text-muted-foreground/70 font-mono mt-1">
            #{campaign.id}
          </div>
        </div>
      </div>

      {/* Metrics Center-Right Panel */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 w-full xl:w-[380px] text-left shrink-0 xl:mr-4">
        {/* Recipients */}
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground/75 uppercase tracking-wider block mb-1">Recipients</span>
          <span className="text-sm font-bold text-foreground block">{showMetrics ? cSent.toLocaleString() : '-'}</span>
          <span className="text-[11px] text-muted-foreground/60 block">{showMetrics ? '100%' : '-'}</span>
        </div>

        {/* Opens */}
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground/75 uppercase tracking-wider block mb-1">Opens</span>
          <span className="text-sm font-bold text-foreground block">{showMetrics ? cOpened.toLocaleString() : '-'}</span>
          <span className="text-[11px] text-muted-foreground/60 block">{showMetrics ? `${campaignOpenRate.toFixed(2)}%` : '-'}</span>
        </div>

        {/* Clicks */}
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground/75 uppercase tracking-wider block mb-1">Clicks</span>
          <span className="text-sm font-bold text-foreground block">{showMetrics ? cClicked.toLocaleString() : '-'}</span>
          <span className="text-[11px] text-muted-foreground/60 block">{showMetrics ? `${campaignClickRate.toFixed(2)}%` : '-'}</span>
        </div>

        {/* Unsubscribed */}
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground/75 uppercase tracking-wider block mb-1">Unsubscribed</span>
          <span className="text-sm font-bold text-foreground block">{showMetrics ? cUnsubscribed.toLocaleString() : '-'}</span>
          <span className="text-[11px] text-muted-foreground/60 block">{showMetrics ? `${campaignUnsubRate.toFixed(2)}%` : '-'}</span>
        </div>
      </div>

      {/* Actions Far-Right Panel */}
      <div className="flex items-center justify-end gap-1 shrink-0 xl:pl-4 xl:border-l border-border/80 w-full xl:w-[140px]">
        {!isSent && (
          <button 
            onClick={() => {
              if (confirm('Are you sure you want to send this campaign now?')) {
                sendMutation.mutate(campaign.id)
              }
            }}
            disabled={sendMutation.isPending}
            className="p-2 text-emerald-500 hover:text-emerald-400 rounded-md-s hover:bg-emerald-500/10 transition-colors md-state-hover"
            title="Send Now"
          >
            {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          </button>
        )}
        {!isSent && (
          <button 
            onClick={() => onEdit(campaign.id)}
            className="p-2 text-muted-foreground hover:text-accent rounded-md-s hover:bg-accent/10 transition-colors md-state-hover"
            title="Edit"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        <button 
          onClick={() => {
            if (confirm('Are you sure you want to duplicate this campaign?')) {
              duplicateMutation.mutate(campaign.id)
            }
          }}
          disabled={duplicateMutation.isPending}
          className="p-2 text-muted-foreground hover:text-accent rounded-md-s hover:bg-accent/10 transition-colors md-state-hover"
          title="Duplicate"
        >
          {duplicateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
        </button>
        <button 
          onClick={() => {
            if (confirm('Are you sure you want to delete this campaign?')) {
              deleteMutation.mutate(campaign.id)
            }
          }}
          disabled={deleteMutation.isPending}
          className="p-2 text-muted-foreground hover:text-destructive rounded-md-s hover:bg-destructive/10 transition-colors md-state-hover"
          title="Delete"
        >
          {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </div>

    </div>
  )
}

function CampaignsPage() {
  const { template: templateId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [wizardState, setWizardState] = useState<{ show: boolean, editId?: number }>({ show: !!templateId })
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)

  const { data: campaignsData, isLoading } = useQuery({
    queryKey: queryKeys.email.campaigns(),
    queryFn: () => campaignsFn(),
  })

  const campaigns = campaignsData?.campaigns || []

  // Slice campaigns for current page
  const paginatedCampaigns = campaigns.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  if (wizardState.show) {
    return (
      <div className="p-4 lg:p-8">
        <CampaignWizard 
          onClose={() => {
            setWizardState({ show: false })
            if (templateId) navigate({ search: {} })
          }} 
          campaignId={wizardState.editId}
          initialTemplateId={wizardState.editId ? undefined : templateId}
        />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-2">Campaigns</h1>
          <p className="text-muted-foreground">Manage and track your email marketing campaigns.</p>
        </div>
        <button 
          onClick={() => setWizardState({ show: true })}
          className="bg-accent text-accent-foreground px-6 py-2.5 rounded-md-s font-medium hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 shadow-accent"
        >
          <Plus className="w-4 h-4" />
          New Campaign
        </button>
      </div>

      <div>
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-md-xl p-5 mb-4 animate-pulse h-[98px]" />
          ))
        ) : campaigns.length === 0 ? (
          <div className="bg-card border border-border rounded-md-xl p-12 text-center text-muted-foreground shadow-sm">
            No campaigns found. Create your first one to get started!
          </div>
        ) : (
          paginatedCampaigns.map((campaign: any) => (
            <CampaignCard 
              key={campaign.id} 
              campaign={campaign} 
              onEdit={(id) => setWizardState({ show: true, editId: id })}
            />
          ))
        )}
      </div>

      <Pagination
        totalItems={campaigns.length}
        itemsPerPage={itemsPerPage}
        onItemsPerPageChange={setItemsPerPage}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
      />
    </div>
  )
}
