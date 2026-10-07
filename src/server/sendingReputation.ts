// How a workspace's email is being received, judged from what it already
// records: bounces, spam complaints, unsubscribes, and whether people open
// it (split by who runs their mail, since "Outlook opens it, Gmail doesn't"
// is the nearest thing to seeing a spam folder from here). Counts only, per
// sending domain and per kind of mail; nothing about who anyone is.
//
// A status is `good`, `at_risk` or `poor`, or `unknown` until MIN_SAMPLE
// emails have gone out in the window. The daily sending limits
// (sendingLimits.ts) grow only while it's good.
//
// With it goes a score out of 100, set by the weakest signal (`score`
// below): 80 and over is good, 50 to 79 at risk, under 50 poor, so the
// number and the status never disagree.

import { db } from './db'
import type { MailKind } from './sendingLimits'

export type ReputationStatus = 'good' | 'at_risk' | 'poor' | 'unknown'
export type MailHost = 'google' | 'microsoft' | 'other'

/** Emails in the window before a rate means anything. */
export const MIN_SAMPLE = 30
export const WINDOW_DAYS = 7

/** Rates at which a status turns. Bounces and complaints are of emails sent; opens, of emails sent with open tracking. */
export const THRESHOLDS = {
  bounce: { at_risk: 0.02, poor: 0.05 },
  complaint: { at_risk: 0.001, poor: 0.003 },
  unsubscribe: { at_risk: 0.02 },
  /** Real opens (scanners left out) below this, with tracking on, suggest the spam folder. */
  opens: { at_risk: 0.1 },
}

export interface SendingStats {
  sent: number
  hardBounces: number
  complaints: number
  unsubscribes: number
  replies: number
  /** Sent with open tracking on, and how many of those a person opened. */
  tracked: number
  opened: number
  byHost: Record<MailHost, { tracked: number; opened: number }>
}

export interface ReputationReason {
  level: 'at_risk' | 'poor'
  code: 'bounces' | 'complaints' | 'unsubscribes' | 'opens' | 'opens_google' | 'opens_microsoft' | 'opens_other'
  text: string
  fix: string
}

export interface Reputation {
  status: ReputationStatus
  /** Out of 100: 80+ good, 50-79 at risk, under 50 poor. Null until there's enough sent to judge. */
  score: number | null
  stats: SendingStats
  reasons: ReputationReason[]
}

/**
 * Points a rate takes off the score: up to 19 short of `atRisk`, 21 at it
 * (so the score drops under 80 exactly where the status turns), 51 at `poor`
 * (under 50), and everything at three times `poor`. Without a `poor` level
 * it stops at 49: that signal alone never makes a reputation poor.
 */
function pointsOff(rate: number, atRisk: number, poor?: number): number {
  if (rate <= 0) return 0
  if (rate < atRisk) return (rate / atRisk) * 19
  if (poor === undefined) return Math.min(49, 21 + ((rate - atRisk) / (atRisk * 2)) * 28)
  if (rate < poor) return 21 + ((rate - atRisk) / (poor - atRisk)) * 28
  return Math.min(100, 51 + ((rate - poor) / (poor * 2)) * 49)
}

/** Points low opens take off: none from GOOD_OPENS up, 21 at the at-risk level, 45 when nobody opens. */
const GOOD_OPENS = 0.3
function pointsOffOpens(rate: number): number {
  const floor = THRESHOLDS.opens.at_risk
  if (rate >= GOOD_OPENS) return 0
  if (rate >= floor) return ((GOOD_OPENS - rate) / (GOOD_OPENS - floor)) * 19
  return 21 + ((floor - rate) / floor) * 24
}

/**
 * The score these numbers earn: 100 less the points its weakest signal
 * takes off (bounces, complaints, unsubscribes, or opens overall or at one
 * mail provider). The weakest alone, since one bad signal is what a mailbox
 * provider acts on; good numbers elsewhere don't make up for it.
 */
export function score(stats: SendingStats): number | null {
  if (stats.sent < MIN_SAMPLE) return null
  const rate = (n: number) => n / stats.sent
  const opens = [stats, ...Object.values(stats.byHost)].filter((s) => s.tracked >= MIN_SAMPLE).map((s) => pointsOffOpens(s.opened / s.tracked))
  const worst = Math.max(
    pointsOff(rate(stats.hardBounces), THRESHOLDS.bounce.at_risk, THRESHOLDS.bounce.poor),
    pointsOff(rate(stats.complaints), THRESHOLDS.complaint.at_risk, THRESHOLDS.complaint.poor),
    pointsOff(rate(stats.unsubscribes), THRESHOLDS.unsubscribe.at_risk),
    ...opens,
  )
  return Math.max(0, Math.round(100 - worst))
}

const emptyStats = (): SendingStats => ({
  sent: 0, hardBounces: 0, complaints: 0, unsubscribes: 0, replies: 0, tracked: 0, opened: 0,
  byHost: { google: { tracked: 0, opened: 0 }, microsoft: { tracked: 0, opened: 0 }, other: { tracked: 0, opened: 0 } },
})

const pct = (n: number, of: number) => `${(Math.round((n / of) * 1000) / 10).toLocaleString('en-GB')}%`
const HOST_NAME: Record<MailHost, string> = { google: 'Google (Gmail)', microsoft: 'Microsoft (Outlook)', other: 'other providers' }
const FREE_MAIL: Record<string, MailHost> = {
  'gmail.com': 'google', 'googlemail.com': 'google',
  'outlook.com': 'microsoft', 'hotmail.com': 'microsoft', 'hotmail.co.uk': 'microsoft', 'live.com': 'microsoft', 'live.co.uk': 'microsoft', 'msn.com': 'microsoft',
}

/** Who runs a recipient's mail, from what the email finder already learned about their domain. */
export function mailHostOf(email: string): MailHost {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return FREE_MAIL[domain] ?? db.getEmailDomain(domain)?.mx_provider ?? 'other'
}

/** The status these numbers earn, and why. */
export function judge(stats: SendingStats): Reputation {
  if (stats.sent < MIN_SAMPLE) return { status: 'unknown', score: null, stats, reasons: [] }
  const reasons: ReputationReason[] = []
  const rate = (n: number) => n / stats.sent

  const bounce = rate(stats.hardBounces)
  if (bounce >= THRESHOLDS.bounce.at_risk) {
    reasons.push({
      level: bounce >= THRESHOLDS.bounce.poor ? 'poor' : 'at_risk',
      code: 'bounces',
      text: `${pct(stats.hardBounces, stats.sent)} of emails bounced (${stats.hardBounces} of ${stats.sent}): the addresses don't exist.`,
      fix: 'Send only to verified addresses, and remove old or guessed ones from your lists.',
    })
  }
  const complaint = rate(stats.complaints)
  if (complaint >= THRESHOLDS.complaint.at_risk) {
    reasons.push({
      level: complaint >= THRESHOLDS.complaint.poor ? 'poor' : 'at_risk',
      code: 'complaints',
      text: `${pct(stats.complaints, stats.sent)} of recipients marked it as spam (${stats.complaints} of ${stats.sent}).`,
      fix: "Email people who expect to hear from you, say why you're writing, and keep the unsubscribe link easy to find.",
    })
  }
  if (rate(stats.unsubscribes) >= THRESHOLDS.unsubscribe.at_risk) {
    reasons.push({
      level: 'at_risk',
      code: 'unsubscribes',
      text: `${pct(stats.unsubscribes, stats.sent)} of recipients unsubscribed (${stats.unsubscribes} of ${stats.sent}).`,
      fix: 'Check the list matches what you send: this many leaving means it reached the wrong people.',
    })
  }
  // Opens say something only where enough were sent with tracking on. One
  // provider far below the rest is the clearest sign of its spam folder.
  const low = (Object.keys(stats.byHost) as MailHost[]).filter((h) => {
    const s = stats.byHost[h]
    return s.tracked >= MIN_SAMPLE && s.opened / s.tracked < THRESHOLDS.opens.at_risk
  })
  for (const host of low) {
    const s = stats.byHost[host]
    reasons.push({
      level: 'at_risk',
      code: `opens_${host}`,
      text: `Only ${pct(s.opened, s.tracked)} of recipients at ${HOST_NAME[host]} opened it (${s.opened} of ${s.tracked}), which usually means it's landing in spam there.`,
      fix: 'Send less, to people more likely to want it, in plainer emails: short text, no offer, one link at most.',
    })
  }
  if (!low.length && stats.tracked >= MIN_SAMPLE && stats.opened / stats.tracked < THRESHOLDS.opens.at_risk) {
    reasons.push({
      level: 'at_risk',
      code: 'opens',
      text: `Only ${pct(stats.opened, stats.tracked)} of recipients opened it (${stats.opened} of ${stats.tracked}), which usually means much of it is landing in spam.`,
      fix: 'Send less, to people more likely to want it, in plainer emails: short text, no offer, one link at most.',
    })
  }
  const status = reasons.some((r) => r.level === 'poor') ? 'poor' : reasons.length ? 'at_risk' : 'good'
  return { status, score: score(stats), stats, reasons }
}

/**
 * Says whether a contact is cold (found by prospecting, and hasn't signed up
 * or replied since) or opted in. Made once per job: it reads who has replied.
 */
export function kindResolver(): (email: string) => MailKind {
  const replied = new Set(db.data.campaign_recipients.filter((r) => r.replied_at).map((r) => r.contact_email))
  const kinds = new Map<string, MailKind>()
  return (email) => {
    if (!kinds.has(email)) {
      const contact = db.getContact(email)
      kinds.set(email, !contact?.source || contact.signed_up_at || replied.has(email) ? 'optIn' : 'cold')
    }
    return kinds.get(email)!
  }
}

/**
 * The last WINDOW_DAYS of sending, added up by sending domain and by kind of
 * mail. Sequence emails count: each step's are recorded as a campaign's.
 */
export function sendingStats(now = new Date()): { byDomain: Map<string, SendingStats>; byKind: Record<MailKind, SendingStats> } {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()
  const campaigns = new Map(db.data.campaigns.map((c) => [c.id, c]))
  const senderDomain = new Map(db.data.senders.map((s) => [s.id, s.email.split('@')[1]?.toLowerCase() ?? '']))
  const kind = kindResolver()
  const byDomain = new Map<string, SendingStats>()
  const byKind: Record<MailKind, SendingStats> = { cold: emptyStats(), optIn: emptyStats() }
  for (const r of db.data.campaign_recipients) {
    if (!r.sent_at || r.sent_at < since) continue
    const campaign = campaigns.get(r.campaign_id)
    const domain = (campaign?.sender_id != null && senderDomain.get(campaign.sender_id)) || ''
    if (domain && !byDomain.has(domain)) byDomain.set(domain, emptyStats())
    const tracked = campaign?.track_opens !== false
    const host = mailHostOf(r.contact_email)
    for (const s of [domain ? byDomain.get(domain)! : null, byKind[kind(r.contact_email)]]) {
      if (!s) continue
      s.sent++
      if (r.status === 'bounced_hard') s.hardBounces++
      if (r.complained_at) s.complaints++
      if (r.unsubscribed_at) s.unsubscribes++
      if (r.replied_at) s.replies++
      if (tracked) {
        s.tracked++
        s.byHost[host].tracked++
        if (r.opened_at) {
          s.opened++
          s.byHost[host].opened++
        }
      }
    }
  }
  return { byDomain, byKind }
}

/** Each sending domain's standing, worst first, for Settings and the host's portal. */
export function domainReputations(now = new Date()): Array<{ domain: string } & Reputation> {
  const order: Record<ReputationStatus, number> = { poor: 0, at_risk: 1, unknown: 2, good: 3 }
  return [...sendingStats(now).byDomain]
    .map(([domain, stats]) => ({ domain, ...judge(stats) }))
    .sort((a, b) => order[a.status] - order[b.status] || b.stats.sent - a.stats.sent)
}
