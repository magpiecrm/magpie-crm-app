import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { useState } from 'react'
import { Calendar, HelpCircle, X } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { campaignsFn } from '../../../server/functions'
import { CampaignSort, useCampaignSort } from '../../../features/campaigns/components/CampaignSort'
import { sortCampaigns } from '../../../features/campaigns/sort'
import { campaignSummary, summariseCampaigns } from '../../../features/campaigns/results'
import { Pagination } from '../../../components/ui/Pagination'
import { ExportMenu } from '../../../components/ui/ExportMenu'
import type { ExportColumn } from '../../../utils/export'

const campaignExportColumns: ExportColumn<any>[] = [
  { header: 'ID', value: c => c.id },
  { header: 'Name', value: c => c.name },
  { header: 'Recipients', value: c => campaignSummary(c).sent },
  { header: 'Opened', value: c => (campaignSummary(c).tracksOpens ? campaignSummary(c).opened : 'Not tracked') },
  { header: 'Clicked', value: c => campaignSummary(c).clicked },
  { header: 'Unsubscribed', value: c => campaignSummary(c).unsubscribed },
  { header: 'Complaints', value: c => campaignSummary(c).complaints },
  { header: 'Bounces', value: c => campaignSummary(c).bounces },
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

function AnalyticsPage() {
  const { data: campaignsData, isLoading } = useQuery({
    queryKey: queryKeys.email.campaigns(),
    queryFn: () => campaignsFn(),
  })

  const [dateRange, setDateRange] = useState({ start: '2026-01-01', end: '2026-12-31' })
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(20)

  const [sort, setSort] = useCampaignSort('analytics')
  const campaigns = campaignsData?.campaigns || []

  // Filter campaigns by date range, in the order chosen (newest first unless changed)
  const filteredCampaigns = sortCampaigns(campaigns, sort).filter((c: any) => {
    const dateStr = c.sentDate || c.createdAt
    if (!dateStr) return true
    const cDate = new Date(dateStr)
    const start = new Date(dateRange.start)
    const end = new Date(dateRange.end)
    end.setHours(23, 59, 59, 999)
    return cDate >= start && cDate <= end
  })
  
  // Totals across the campaigns shown. Opens are divided by what was delivered in campaigns that track them.
  const totals = summariseCampaigns(filteredCampaigns)
  const totalCampaignsCount = filteredCampaigns.filter((c: any) => c.status === 'sent' || c.status === 'suspended').length
  const { sent: totalSent, opened: totalOpened, clicked: totalClicked, unsubscribed: totalUnsubscribed, bounces: totalBounces } = totals
  const { openRate, clickRate, unsubRate, bounceRate } = totals
  const totalReplies = 0

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
                      <span title="Unique opens / Delivered emails, in campaigns that track opens" className="inline-flex">
                        <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/40 cursor-help" />
                      </span>
                    </span>
                    <span className="text-2xl font-semibold text-foreground font-display">{totals.trackedDelivered > 0 ? `${openRate.toFixed(2)}%` : '–'}</span>
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
              <div className="flex flex-wrap items-center justify-end gap-3">
              <CampaignSort
                value={sort}
                onChange={(next) => {
                  setSort(next)
                  setCurrentPage(1)
                }}
              />
              <ExportMenu
                filename="email_campaigns"
                sheetName="Campaigns"
                rows={filteredCampaigns}
                columns={campaignExportColumns}
              />
              </div>
            </div>
            
            {/* Mobile card list — 10 columns can't be read on a phone */}
            <ul className="md:hidden divide-y divide-border">
              {filteredCampaigns.length === 0 ? (
                <li className="px-6 py-12 text-center text-muted-foreground text-sm">
                  No campaigns found for the selected date range.
                </li>
              ) : (
                paginatedCampaigns.map((campaign: any) => {
                  const s = campaignSummary(campaign)
                  const metrics = [
                    { label: 'Recipients', value: `${s.sent}`, sub: '100%', tone: 'text-foreground' },
                    s.openRate === null
                      ? { label: 'Opened', value: 'Not tracked', sub: '', tone: 'text-muted-foreground' }
                      : { label: 'Opened', value: `${s.opened}`, sub: `${s.openRate.toFixed(1)}%`, tone: 'text-indigo-500' },
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
                      } = campaignSummary(campaign)

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
                              {campaignOpenRate === null ? (
                                <span className="text-muted-foreground" title="This campaign was sent with open tracking off">Not tracked</span>
                              ) : (
                                <div>
                                  <span className="text-indigo-500 font-semibold">{cOpened}</span>
                                  <span className="text-muted-foreground text-xs ml-1.5">{campaignOpenRate.toFixed(2)}%</span>
                                </div>
                              )}
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
