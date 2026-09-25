import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { useState } from 'react'
import { Calendar, HelpCircle, X } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { campaignsFn } from '../../../server/functions'
import { Pagination } from '../../../components/ui/Pagination'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import type { ExportColumn } from '../../../utils/export'

/**
 * Brevo reports totals in `globalStats`, but older campaigns only carry a
 * per-list `campaignStats` array — fall back to summing that when the globals
 * are empty.
 */
function resolveCampaignStats(campaign: any) {
  const globalStats = campaign.statistics?.globalStats || {}
  const perList = campaign.statistics?.campaignStats || []

  const totals = {
    sent: globalStats.sent || 0,
    opened: globalStats.uniqueViews || globalStats.viewed || 0,
    clicked: globalStats.uniqueClicks || globalStats.clickers || 0,
    unsubscribed: globalStats.unsubscriptions || 0,
    complaints: globalStats.complaints || 0,
    bounces: (globalStats.softBounces || 0) + (globalStats.hardBounces || 0),
  }

  if (totals.sent === 0 && perList.length > 0) {
    const sum = (fn: (cs: any) => number) => perList.reduce((acc: number, cs: any) => acc + fn(cs), 0)
    totals.sent = sum(cs => cs.sent || 0)
    totals.opened = sum(cs => cs.uniqueViews || cs.viewed || 0)
    totals.clicked = sum(cs => cs.uniqueClicks || cs.clickers || 0)
    totals.unsubscribed = sum(cs => cs.unsubscriptions || 0)
    totals.complaints = sum(cs => cs.complaints || 0)
    totals.bounces = sum(cs => (cs.softBounces || 0) + (cs.hardBounces || 0))
  }

  return totals
}

const campaignExportColumns: ExportColumn<any>[] = [
  { header: 'ID', value: c => c.id },
  { header: 'Name', value: c => c.name },
  { header: 'Recipients', value: c => resolveCampaignStats(c).sent },
  { header: 'Opened', value: c => resolveCampaignStats(c).opened },
  { header: 'Clicked', value: c => resolveCampaignStats(c).clicked },
  { header: 'Unsubscribed', value: c => resolveCampaignStats(c).unsubscribed },
  { header: 'Complaints', value: c => resolveCampaignStats(c).complaints },
  { header: 'Bounces', value: c => resolveCampaignStats(c).bounces },
  { header: 'Sent Date', value: c => c.sentDate || c.createdAt || '' },
  { header: 'Status', value: c => c.status },
]

export const Route = createFileRoute('/marketing/analytics/')({
  component: AnalyticsPage,
})

function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  const day = date.getDate()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months[date.getMonth()]
  const year = date.getFullYear()
  
  let hours = date.getHours()
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12
  hours = hours ? hours : 12 // the hour '0' should be '12'
  
  return `${day} ${month}, ${year} ${hours}:${minutes} ${ampm}`
}

/**
 * Brevo reports the same numbers in two shapes depending on the campaign, so
 * fold both into one row of stats. Shared by the desktop table and the mobile
 * card list.
 */
function deriveCampaignStats(campaign: any) {
  const globalStats = campaign.statistics?.globalStats || {}
  const campaignStatsArray = campaign.statistics?.campaignStats || []

  let sent = globalStats.sent || 0
  let delivered = globalStats.delivered || 0
  let opened = globalStats.uniqueViews || globalStats.viewed || 0
  let clicked = globalStats.uniqueClicks || globalStats.clickers || 0
  let unsubscribed = globalStats.unsubscriptions || 0
  let complaints = globalStats.complaints || 0
  let bounces = (globalStats.softBounces || 0) + (globalStats.hardBounces || 0)

  if (sent === 0 && campaignStatsArray.length > 0) {
    sent = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.sent || 0), 0)
    delivered = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.delivered || 0), 0)
    opened = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.uniqueViews || cs.viewed || 0), 0)
    clicked = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.uniqueClicks || cs.clickers || 0), 0)
    unsubscribed = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.unsubscriptions || 0), 0)
    complaints = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.complaints || 0), 0)
    bounces = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.softBounces || 0) + (cs.hardBounces || 0), 0)
  }

  if (delivered === 0 && sent > 0) {
    delivered = Math.max(0, sent - bounces)
  }

  const rate = (n: number, of: number) => (of > 0 ? (n / of) * 100 : 0)

  return {
    sent,
    delivered,
    opened,
    clicked,
    unsubscribed,
    complaints,
    bounces,
    openRate: rate(opened, delivered),
    clickRate: rate(clicked, delivered),
    unsubRate: rate(unsubscribed, delivered),
    complaintRate: rate(complaints, delivered),
    bounceRate: rate(bounces, sent),
  }
}

function AnalyticsPage() {
  const { data: campaignsData, isLoading } = useQuery({
    queryKey: queryKeys.email.campaigns(),
    queryFn: () => campaignsFn(),
  })

  const [dateRange, setDateRange] = useState({ start: '2026-01-01', end: '2026-12-31' })
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)

  const campaigns = campaignsData?.campaigns || []

  // Filter campaigns by date range
  const filteredCampaigns = campaigns.filter((c: any) => {
    const dateStr = c.sentDate || c.createdAt
    if (!dateStr) return true
    const cDate = new Date(dateStr)
    const start = new Date(dateRange.start)
    const end = new Date(dateRange.end)
    end.setHours(23, 59, 59, 999)
    return cDate >= start && cDate <= end
  })
  
  // Aggregate metrics
  let totalCampaignsCount = 0
  let totalSent = 0
  let totalDelivered = 0
  let totalOpened = 0
  let totalClicked = 0
  let totalUnsubscribed = 0
  let totalComplaints = 0
  let totalBounces = 0
  let totalReplies = 0

  filteredCampaigns.forEach((c: any) => {
    if (c.status === 'sent' || c.status === 'suspended') {
      totalCampaignsCount++
    }

    const globalStats = c.statistics?.globalStats || {}
    const campaignStatsArray = c.statistics?.campaignStats || []

    let cSent = globalStats.sent || 0
    let cDelivered = globalStats.delivered || 0
    let cOpened = globalStats.uniqueViews || globalStats.viewed || 0
    let cClicked = globalStats.uniqueClicks || globalStats.clickers || 0
    let cUnsubscribed = globalStats.unsubscriptions || 0
    let cComplaints = globalStats.complaints || 0
    let cBounces = (globalStats.softBounces || 0) + (globalStats.hardBounces || 0)

    // Fallback: if stats missing in list, aggregate from campaignStats array
    if (cSent === 0 && campaignStatsArray.length > 0) {
      cSent = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.sent || 0), 0)
      cDelivered = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.delivered || 0), 0)
      cOpened = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.uniqueViews || cs.viewed || 0), 0)
      cClicked = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.uniqueClicks || cs.clickers || 0), 0)
      cUnsubscribed = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.unsubscriptions || 0), 0)
      cComplaints = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.complaints || 0), 0)
      cBounces = campaignStatsArray.reduce((acc: number, cs: any) => acc + (cs.softBounces || 0) + (cs.hardBounces || 0), 0)
    }

    if (cDelivered === 0 && cSent > 0) {
      cDelivered = cSent - cBounces
      if (cDelivered < 0) cDelivered = 0
    }

    totalSent += cSent
    totalDelivered += cDelivered
    totalOpened += cOpened
    totalClicked += cClicked
    totalUnsubscribed += cUnsubscribed
    totalComplaints += cComplaints
    totalBounces += cBounces
  })

  // Rates based on standard metrics
  const openRate = totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0
  const clickRate = totalDelivered > 0 ? (totalClicked / totalDelivered) * 100 : 0
  const unsubRate = totalDelivered > 0 ? (totalUnsubscribed / totalDelivered) * 100 : 0
  const bounceRate = totalSent > 0 ? (totalBounces / totalSent) * 100 : 0

  // Slice campaigns for current page
  const paginatedCampaigns = filteredCampaigns.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  return (
    <div className="p-4 lg:p-8 w-full">
      {/* Title & Info */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-1">Analytics</h1>
          <p className="text-sm text-muted-foreground">Track and analyze performance metrics across your email campaigns.</p>
        </div>

        {/* Date Picker Capsule */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-card border border-border rounded-md px-3 py-1.5 text-sm shadow-sm">
            <input 
              type="date" 
              value={dateRange.start}
              onChange={(e) => {
                setDateRange(prev => ({ ...prev, start: e.target.value }))
                setCurrentPage(1)
              }}
              className="bg-transparent border-none text-foreground outline-none focus:ring-0 w-32 [color-scheme:dark]"
            />
            <span className="text-muted-foreground mx-1">-</span>
            <input 
              type="date" 
              value={dateRange.end}
              onChange={(e) => {
                setDateRange(prev => ({ ...prev, end: e.target.value }))
                setCurrentPage(1)
              }}
              className="bg-transparent border-none text-foreground outline-none focus:ring-0 w-32 [color-scheme:dark]"
            />
            { (dateRange.start !== '2026-01-01' || dateRange.end !== '2026-12-31') && (
              <button 
                onClick={() => {
                  setDateRange({ start: '2026-01-01', end: '2026-12-31' })
                  setCurrentPage(1)
                }}
                className="ml-2 text-muted-foreground hover:text-foreground transition-colors"
                title="Reset Date Range"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <Calendar className="w-4 h-4 text-muted-foreground ml-2" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-muted-foreground">Loading campaign analytics...</div>
      ) : (
        <>
          {/* Summary Panel */}
          <div className="card border border-border p-6 mb-8 bg-card">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-6">
              <h3 className="font-display font-medium text-foreground">Summary</h3>
              <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium bg-emerald-500/5 px-2.5 py-1 rounded-full border border-emerald-500/10">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Automated opens and clicks excluded.
                <HelpCircle className="w-3.5 h-3.5 text-muted-foreground ml-0.5 cursor-help" />
              </div>
            </div>
            
            <div>
              {/* Wraps to 2 columns on phones rather than forcing a 900px scroll */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-px bg-border border border-border rounded-lg overflow-hidden [&>div]:bg-muted/10">
                {/* Column 1 */}
                <div className="flex flex-col">
                  <div className="p-4 border-b border-border flex flex-col justify-between h-24">
                    <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                      Sent
                      <span title="Number of campaigns sent" className="inline-flex">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/40 cursor-help" />
                      </span>
                    </span>
                    <span className="text-2xl font-semibold text-foreground font-display">{totalCampaignsCount}</span>
                  </div>
                  <div className="p-4 flex flex-col justify-between h-24 bg-muted/5">
                    <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                      Soft + Hard Bounces
                      <span title="Total bounced emails" className="inline-flex">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/40 cursor-help" />
                      </span>
                    </span>
                    <div>
                      <span className="text-2xl font-semibold text-foreground font-display">{totalBounces}</span>
                      <span className="text-xs text-muted-foreground ml-1">({bounceRate.toFixed(2)}%)</span>
                    </div>
                  </div>
                </div>

                {/* Column 2 */}
                <div className="flex flex-col">
                  <div className="p-4 border-b border-border flex flex-col justify-between h-24">
                    <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                      Recipients
                      <span title="Total recipients targeted" className="inline-flex">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/40 cursor-help" />
                      </span>
                    </span>
                    <span className="text-2xl font-semibold text-foreground font-display">{totalSent.toLocaleString()}</span>
                  </div>
                  <div className="p-4 flex flex-col justify-between h-24 bg-muted/5">
                    <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                      Replies
                      <span title="Replies to campaign emails" className="inline-flex">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/40 cursor-help" />
                      </span>
                    </span>
                    <span className="text-2xl font-semibold text-foreground font-display">{totalReplies}</span>
                  </div>
                </div>

                {/* Column 3 */}
                <div className="flex flex-col">
                  <div className="p-4 border-b border-border flex flex-col justify-between h-24">
                    <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                      Opens
                      <span title="Total unique opens" className="inline-flex">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/40 cursor-help" />
                      </span>
                    </span>
                    <span className="text-2xl font-semibold text-foreground font-display">{totalOpened.toLocaleString()}</span>
                  </div>
                  <div className="p-4 flex flex-col justify-between h-24 bg-muted/5">
                    <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                      Open Rate
                      <span title="Unique opens / Delivered emails" className="inline-flex">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/40 cursor-help" />
                      </span>
                    </span>
                    <span className="text-2xl font-semibold text-foreground font-display">{openRate.toFixed(2)}%</span>
                  </div>
                </div>

                {/* Column 4 */}
                <div className="flex flex-col">
                  <div className="p-4 border-b border-border flex flex-col justify-between h-24">
                    <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                      Clicks
                      <span title="Total unique clicks" className="inline-flex">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/40 cursor-help" />
                      </span>
                    </span>
                    <span className="text-2xl font-semibold text-foreground font-display">{totalClicked.toLocaleString()}</span>
                  </div>
                  <div className="p-4 flex flex-col justify-between h-24 bg-muted/5">
                    <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                      Click Rate
                      <span title="Unique clicks / Delivered emails" className="inline-flex">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/40 cursor-help" />
                      </span>
                    </span>
                    <span className="text-2xl font-semibold text-foreground font-display">{clickRate.toFixed(2)}%</span>
                  </div>
                </div>

                {/* Column 5 */}
                <div className="flex flex-col">
                  <div className="p-4 border-b border-border flex flex-col justify-between h-24">
                    <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                      Unsubscribes
                      <span title="Total unsubscriptions" className="inline-flex">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/40 cursor-help" />
                      </span>
                    </span>
                    <span className="text-2xl font-semibold text-foreground font-display">{totalUnsubscribed}</span>
                  </div>
                  <div className="p-4 flex flex-col justify-between h-24 bg-muted/5">
                    <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                      Unsubscription Rate
                      <span title="Unsubscriptions / Delivered emails" className="inline-flex">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/40 cursor-help" />
                      </span>
                    </span>
                    <span className="text-2xl font-semibold text-foreground font-display">{unsubRate.toFixed(2)}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Campaigns Benchmarking Table */}
          <div className="card border border-border overflow-hidden bg-card">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-muted/5">
              <h3 className="font-display font-medium text-foreground">Email Campaigns</h3>
              <ExportMenu
                filename="email_campaigns"
                sheetName="Campaigns"
                rows={filteredCampaigns}
                columns={campaignExportColumns}
              />
            </div>
            
            {/* Mobile card list — 10 columns can't be read on a phone */}
            <ul className="md:hidden divide-y divide-border">
              {filteredCampaigns.length === 0 ? (
                <li className="px-6 py-12 text-center text-muted-foreground text-sm">
                  No campaigns found for the selected date range.
                </li>
              ) : (
                paginatedCampaigns.map((campaign: any) => {
                  const s = deriveCampaignStats(campaign)
                  const metrics = [
                    { label: 'Recipients', value: `${s.sent}`, sub: '100%', tone: 'text-foreground' },
                    { label: 'Opened', value: `${s.opened}`, sub: `${s.openRate.toFixed(1)}%`, tone: 'text-indigo-500' },
                    { label: 'Clicked', value: `${s.clicked}`, sub: `${s.clickRate.toFixed(1)}%`, tone: 'text-emerald-500' },
                    { label: 'Unsubscribed', value: `${s.unsubscribed}`, sub: `${s.unsubRate.toFixed(1)}%`, tone: 'text-foreground' },
                    { label: 'Complaints', value: `${s.complaints}`, sub: `${s.complaintRate.toFixed(1)}%`, tone: 'text-foreground' },
                    { label: 'Bounces', value: `${s.bounces}`, sub: `${s.bounceRate.toFixed(1)}%`, tone: 'text-foreground' },
                  ]

                  return (
                    <li key={campaign.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate">{campaign.name}</p>
                          <p className="text-[11px] text-muted-foreground font-mono">
                            #{campaign.id} · {formatDate(campaign.sentDate || campaign.createdAt)}
                          </p>
                        </div>
                        <Badge variant={campaign.status === 'sent' ? 'success' : campaign.status === 'suspended' ? 'error' : 'default'}>
                          {campaign.status}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {metrics.map(m => (
                          <div key={m.label} className="bg-muted/20 rounded-lg p-2">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{m.label}</p>
                            <p className={`text-sm font-semibold ${m.tone}`}>
                              {m.value}
                              <span className="text-[10px] text-muted-foreground ml-1">{m.sub}</span>
                            </p>
                          </div>
                        ))}
                      </div>
                    </li>
                  )
                })
              )}
            </ul>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1000px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-6 py-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-16">ID</th>
                    <th className="px-6 py-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                    <th className="px-6 py-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Recipients</th>
                    <th className="px-6 py-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Opened</th>
                    <th className="px-6 py-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Clicked</th>
                    <th className="px-6 py-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Unsubscribed</th>
                    <th className="px-6 py-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Complaints</th>
                    <th className="px-6 py-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Bounces</th>
                    <th className="px-6 py-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Sent Date</th>
                    <th className="px-6 py-4 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-24">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-12 text-center text-muted-foreground">
                        No campaigns found for the selected date range.
                      </td>
                    </tr>
                  ) : (
                    paginatedCampaigns.map((campaign: any) => {
                      const {
                        sent: cSent,
                        opened: cOpened,
                        clicked: cClicked,
                        unsubscribed: cUnsubscribed,
                        complaints: cComplaints,
                        bounces: cBounces,
                        openRate: campaignOpenRate,
                        clickRate: campaignClickRate,
                        unsubRate: campaignUnsubRate,
                        complaintRate: campaignComplaintRate,
                        bounceRate: campaignBounceRate,
                      } = deriveCampaignStats(campaign)

                      return (
                        <tr key={campaign.id} className="hover:bg-muted/30 transition-colors text-sm">
                          {/* ID */}
                          <td className="px-6 py-4 text-muted-foreground font-mono">#{campaign.id}</td>
                          
                          {/* Name */}
                          <td className="px-6 py-4 font-medium text-foreground">{campaign.name}</td>
                          
                          {/* Recipients */}
                          <td className="px-6 py-4">
                            <span className="text-foreground font-semibold">{cSent}</span>
                            <span className="text-muted-foreground text-xs ml-1.5">100%</span>
                          </td>
                          
                          {/* Opened */}
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <div>
                                <span className="text-indigo-500 font-semibold">{cOpened}</span>
                                <span className="text-muted-foreground text-xs ml-1.5">{campaignOpenRate.toFixed(2)}%</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground/60 hover:text-indigo-400 hover:underline cursor-pointer select-none mt-0.5">Details</span>
                            </div>
                          </td>
                          
                          {/* Clicked */}
                          <td className="px-6 py-4">
                            <span className="text-emerald-500 font-semibold">{cClicked}</span>
                            <span className="text-muted-foreground text-xs ml-1.5">{campaignClickRate.toFixed(2)}%</span>
                          </td>
                          
                          {/* Unsubscribed */}
                          <td className="px-6 py-4">
                            <span className="text-foreground font-semibold">{cUnsubscribed}</span>
                            <span className="text-muted-foreground text-xs ml-1.5">{campaignUnsubRate.toFixed(2)}%</span>
                          </td>
                          
                          {/* Complaints */}
                          <td className="px-6 py-4">
                            <span className="text-foreground font-semibold">{cComplaints}</span>
                            <span className="text-muted-foreground text-xs ml-1.5">{campaignComplaintRate.toFixed(2)}%</span>
                          </td>
                          
                          {/* Bounces */}
                          <td className="px-6 py-4">
                            <span className="text-foreground font-semibold">{cBounces}</span>
                            <span className="text-muted-foreground text-xs ml-1.5">{campaignBounceRate.toFixed(2)}%</span>
                          </td>
                          
                          {/* Sent Date */}
                          <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                            {formatDate(campaign.sentDate || campaign.createdAt)}
                          </td>
                          
                          {/* Status */}
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Badge variant={campaign.status === 'sent' ? 'success' : campaign.status === 'suspended' ? 'error' : 'default'}>
                              {campaign.status}
                            </Badge>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-6 pb-2">
              <Pagination
                totalItems={filteredCampaigns.length}
                itemsPerPage={itemsPerPage}
                onItemsPerPageChange={setItemsPerPage}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
