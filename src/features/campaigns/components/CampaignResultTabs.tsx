import { useRef, useState } from 'react'
import { Info } from 'lucide-react'
import { ActivityChart } from './ActivityChart'
import { LinkClicksTable } from './LinkClicksTable'
import { RecipientActivityTable } from './RecipientActivityTable'
import { activityOverTime, percent, type CampaignActivity, type CampaignTotals } from '../results'

/**
 * The campaign page's Deliverability, Opens, Clicks and Unsubscribes tabs:
 * each has its numbers, then the people behind them. Before a campaign is
 * sent the numbers show as dashes and nothing else.
 */
interface TabProps {
  totals: CampaignTotals
  /** Undefined until the campaign is sent and its activity has loaded. */
  activity: CampaignActivity | undefined
  sentAt: string | null
  hasResults: boolean
  /** The campaign carried the open-tracking image (a setting on each campaign). */
  tracksOpens: boolean
}

function Tiles({ title, tiles, hasResults }: { title: string; tiles: Array<[string, string]>; hasResults: boolean }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-foreground mb-4">{title}</h2>
      <div className={`grid grid-cols-2 gap-4 ${tiles.length > 4 ? 'md:grid-cols-3 lg:grid-cols-6' : 'md:grid-cols-4'}`}>
        {tiles.map(([label, value]) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4 shadow-sm">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase block mb-1">{label}</span>
            <span className="text-2xl font-extrabold text-foreground tabular-nums">{hasResults ? value : '-'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
      <span>{children}</span>
    </p>
  )
}

function Loading({ hasResults }: { hasResults: boolean }) {
  return hasResults ? (
    <div className="h-48 bg-muted animate-pulse rounded-xl" />
  ) : (
    <div className="bg-card border border-border rounded-xl py-12 text-center text-sm text-muted-foreground">
      Results appear here once the campaign has been sent.
    </div>
  )
}

function OverTime({ title, activity, sentAt, series }: { title: string; activity: CampaignActivity; sentAt: string | null; series: Array<'opens' | 'clicks'> }) {
  if (!sentAt) return null
  const { buckets, hourly } = activityOverTime(activity.recipients, sentAt)
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <h3 className="text-sm font-bold text-foreground mb-4">
        {title} by {hourly ? 'hour' : 'day'} since sending
      </h3>
      <ActivityChart buckets={buckets} hourly={hourly} series={series} />
    </div>
  )
}

export function DeliverabilityTab({ totals: t, activity, hasResults }: TabProps) {
  const bounced = t.softBounces + t.hardBounces
  return (
    <div className="space-y-8">
      <Tiles
        title="Deliverability details"
        hasResults={hasResults}
        tiles={[
          ['Sent to', t.sent.toLocaleString()],
          ['Delivered', t.delivered.toLocaleString()],
          ['Delivery rate', percent(t.delivered, t.sent)],
          ['Soft bounces', t.softBounces.toLocaleString()],
          ['Hard bounces', t.hardBounces.toLocaleString()],
          ['Bounce rate', percent(bounced, t.sent)],
        ]}
      />
      {hasResults && (
        <Note>
          A hard bounce means the address doesn't exist; a soft bounce is temporary, such as a full inbox or a busy server. Contacts
          whose email bounces back are marked bounced and left out of later campaigns.
        </Note>
      )}
      {activity ? (
        <RecipientActivityTable
          title="Bounced"
          recipients={activity.recipients}
          filters={['bounced']}
          empty="No bounces."
        />
      ) : (
        <Loading hasResults={hasResults} />
      )}
    </div>
  )
}

export function OpensTab({ totals: t, activity, sentAt, hasResults, tracksOpens }: TabProps) {
  if (!tracksOpens) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-foreground">Opens details</h2>
        <Note>Open tracking was off for this campaign, so opens aren't recorded. Clicks, bounces and unsubscribes are.</Note>
      </div>
    )
  }
  return (
    <div className="space-y-8">
      <Tiles
        title="Opens details"
        hasResults={hasResults}
        tiles={[
          ['Opened', t.opened.toLocaleString()],
          ['Open rate', percent(t.opened, t.delivered)],
          ['Total opens', t.totalOpens.toLocaleString()],
          ["Didn't open", Math.max(0, t.delivered - t.opened).toLocaleString()],
        ]}
      />
      {hasResults && (
        <Note>
          Opens count when the email's images load. Loads by email security scanners are left out
          {t.automatedOpens > 0 ? ` (${t.automatedOpens.toLocaleString()} this time)` : ''}, but Apple Mail loads images for people
          automatically and some apps block them, so treat opens as a guide. Someone who clicks counts as opened even if their
          images were off.
        </Note>
      )}
      {activity ? (
        <>
          <OverTime title="First opens" activity={activity} sentAt={sentAt} series={['opens']} />
          <RecipientActivityTable
            title="Who opened"
            recipients={activity.recipients}
            filters={['opened', 'unopened']}
          />
        </>
      ) : (
        <Loading hasResults={hasResults} />
      )}
    </div>
  )
}

export function ClicksTab({ totals: t, activity, sentAt, hasResults, tracksOpens }: TabProps) {
  const [link, setLink] = useState<string | null>(null)
  const people = useRef<HTMLDivElement>(null)
  return (
    <div className="space-y-8">
      <Tiles
        title="Clicks details"
        hasResults={hasResults}
        tiles={[
          ['Clicked', t.clicked.toLocaleString()],
          ['Click-through rate', percent(t.clicked, t.delivered)],
          ['Total clicks', t.totalClicks.toLocaleString()],
          ['Click-to-open rate', tracksOpens ? percent(t.clicked, t.opened) : 'Not tracked'],
        ]}
      />
      {hasResults && (
        <Note>
          Only people's clicks are counted. Many companies' email security scans every link as an email arrives, which isn't a
          person clicking
          {t.automatedClicks > 0
            ? `: ${t.automatedClicks.toLocaleString()} ${t.automatedClicks === 1 ? 'click like that was' : 'clicks like that were'} left out.`
            : '.'}
        </Note>
      )}
      {activity ? (
        <>
          <OverTime title="First clicks" activity={activity} sentAt={sentAt} series={['clicks']} />
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-foreground">Links</h3>
            <LinkClicksTable
              links={activity.links}
              delivered={t.delivered}
              onShowPeople={(url) => {
                setLink(url)
                people.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            />
          </div>
          <div ref={people} className="scroll-mt-4">
            <RecipientActivityTable
              title="Who clicked"
              recipients={activity.recipients}
              filters={['clicked']}
              link={link}
              onClearLink={() => setLink(null)}
              empty="Nobody has clicked yet."
            />
          </div>
        </>
      ) : (
        <Loading hasResults={hasResults} />
      )}
    </div>
  )
}

export function UnsubscribesTab({ totals: t, activity, hasResults }: TabProps) {
  return (
    <div className="space-y-8">
      <Tiles
        title="Unsubscribes details"
        hasResults={hasResults}
        tiles={[
          ['Unsubscribes', t.unsubscribed.toLocaleString()],
          ['Unsubscribe rate', percent(t.unsubscribed, t.delivered)],
          ['Spam complaints', t.complaints.toLocaleString()],
          ['Spam complaint rate', percent(t.complaints, t.delivered)],
        ]}
      />
      {hasResults && (
        <Note>
          Anyone who unsubscribes or marks the email as spam is unsubscribed straight away and not emailed again. Gmail and Yahoo
          ask bulk senders to keep spam complaints under 0.1%, and never reach 0.3%.
        </Note>
      )}
      {activity ? (
        <RecipientActivityTable
          title="Who unsubscribed"
          recipients={activity.recipients}
          filters={['unsubscribed']}
          empty="Nobody has unsubscribed."
        />
      ) : (
        <Loading hasResults={hasResults} />
      )}
    </div>
  )
}
