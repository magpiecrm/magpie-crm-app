// Daily sending limits for a workspace whose email goes out through its
// host's mail server (SENDING_MANAGED), where every workspace shares the same
// IPs. A new sender starts small and the limit steps up each week while its
// email is received well (sendingReputation.ts), the way mailbox providers
// expect a new sender to behave; one that sent its whole month on day one
// was filed as spam, along with everyone sharing its IPs.
//
// Cold email (to contacts found by prospecting, who haven't signed up or
// replied) and opt-in email are limited apart: cold starts lower, grows more
// slowly and stops at a ceiling. The opt-in limit goes away after its last
// step, leaving the plan's monthly allowance.
//
//   week          1    2     3      4      5     6+
//   cold         30   60   100    150    200    300 a day
//   opt-in      200  500  1,000  2,500  5,000   (plan allowance)
//
// A week with a `poor` reputation steps the limit down; `at_risk`, or too few
// sends to judge, holds it. The host can set either limit for a workspace
// itself (its admin portal, through hostRules.ts). Anything over today's
// limit isn't refused: campaigns carry on the next day (emailService.ts) and
// sequences wait (sequences/engine.ts).

import { db } from './db'
import { env } from './env'
import { hostSendLimits } from './prospecting/hostRules'
import { judge, kindResolver, sendingStats, MIN_SAMPLE, type ReputationStatus } from './sendingReputation'

export type MailKind = 'cold' | 'optIn'
export const MAIL_KINDS: MailKind[] = ['cold', 'optIn']

/** Emails a day at each step; past the last, cold stays there and opt-in has no daily limit. */
export const RAMP: Record<MailKind, number[]> = { cold: [30, 60, 100, 150, 200, 300], optIn: [200, 500, 1000, 2500, 5000] }
const STEP_MS = 7 * 86_400_000
const DAY_MS = 86_400_000

export interface RampState {
  /** Index into RAMP; for opt-in, RAMP.optIn.length means no daily limit. */
  level: number
  /** When it reached this level: the next step is judged a week later. */
  since: string
}

export interface DailyLimit {
  /** Emails a day, or null for none. */
  limit: number | null
  /** Sent in the last 24 hours. */
  sent: number
  /** What's left of today's limit; null when there's no limit. */
  left: number | null
  /** When the limit is next judged (and steps up if the week went well); null at the top, or when the host set it. */
  nextStepAt: string | null
  /** What it steps up to then. */
  nextLimit: number | null
  /** How this kind of mail was received over the last week. */
  status: ReputationStatus
  /** Set by the host, rather than the ramp. */
  setByHost: boolean
}

const topLevel = (kind: MailKind) => (kind === 'cold' ? RAMP.cold.length - 1 : RAMP.optIn.length)
const limitAt = (kind: MailKind, level: number): number | null => RAMP[kind][level] ?? null

/** Whether daily limits apply here at all: only where the host's mail server sends. */
export const limitsApply = () => env.sendingManaged()

/**
 * This kind's place on the ramp, started the first time it's asked for and
 * stepped once a week. A workspace that was already sending starts opt-in
 * where its weeks of sending put it; cold always starts at the first step.
 */
function rampState(kind: MailKind, now: Date): RampState {
  const saved = db.data.sending_ramp?.[kind]
  if (!saved) {
    const first = db.data.campaign_recipients.reduce<string | null>((min, r) => (r.sent_at && (!min || r.sent_at < min) ? r.sent_at : min), null)
    const weeks = first ? Math.floor((now.getTime() - Date.parse(first)) / STEP_MS) : 0
    const state: RampState = { level: kind === 'optIn' ? Math.min(Math.max(weeks, 0), topLevel('optIn')) : 0, since: now.toISOString() }
    db.mutate((d) => (d.sending_ramp = { ...d.sending_ramp, [kind]: state }))
    return state
  }
  if (now.getTime() - Date.parse(saved.since) < STEP_MS) return saved
  // A week on: up if it was received well, down if badly, else as it was.
  const { status } = judge(sendingStats(now).byKind[kind])
  const level = status === 'good' ? Math.min(saved.level + 1, topLevel(kind)) : status === 'poor' ? Math.max(saved.level - 1, 0) : saved.level
  const state: RampState = { level, since: now.toISOString() }
  db.mutate((d) => (d.sending_ramp = { ...d.sending_ramp, [kind]: state }))
  return state
}

/** Emails of each kind sent in the last 24 hours (sequence emails included). */
function sentLastDay(now: Date): Record<MailKind, number> {
  const since = new Date(now.getTime() - DAY_MS).toISOString()
  const kind = kindResolver()
  const sent: Record<MailKind, number> = { cold: 0, optIn: 0 }
  for (const r of db.data.campaign_recipients) if (r.sent_at && r.sent_at >= since) sent[kind(r.contact_email)]++
  return sent
}

/** Today's limits and what's left of them; null where none apply (not a hosted copy's mail server). */
export function dailyLimits(now = new Date()): Record<MailKind, DailyLimit> | null {
  if (!limitsApply()) return null
  const sent = sentLastDay(now)
  const stats = sendingStats(now).byKind
  const fromHost = hostSendLimits()
  const one = (kind: MailKind): DailyLimit => {
    const { status } = judge(stats[kind])
    const set = fromHost?.[kind]
    if (set !== undefined && set !== null) {
      return { limit: set, sent: sent[kind], left: Math.max(0, set - sent[kind]), nextStepAt: null, nextLimit: null, status, setByHost: true }
    }
    const state = rampState(kind, now)
    const limit = limitAt(kind, state.level)
    const atTop = state.level >= topLevel(kind)
    return {
      limit,
      sent: sent[kind],
      left: limit === null ? null : Math.max(0, limit - sent[kind]),
      nextStepAt: atTop ? null : new Date(Date.parse(state.since) + STEP_MS).toISOString(),
      nextLimit: atTop ? null : limitAt(kind, state.level + 1),
      status,
      setByHost: false,
    }
  }
  return { cold: one('cold'), optIn: one('optIn') }
}

/**
 * Splits recipients into those today's limits have room for and those who
 * wait, in order. Everyone goes where no limits apply.
 */
export function takeDailyShare<T extends { email: string }>(recipients: T[], now = new Date()): { send: T[]; later: T[]; limits: Record<MailKind, DailyLimit> | null } {
  const limits = dailyLimits(now)
  if (!limits) return { send: recipients, later: [], limits }
  const kind = kindResolver()
  const left: Record<MailKind, number> = { cold: limits.cold.left ?? Infinity, optIn: limits.optIn.left ?? Infinity }
  const send: T[] = []
  const later: T[] = []
  for (const r of recipients) {
    const k = kind(r.email)
    if (left[k] > 0) {
      left[k]--
      send.push(r)
    } else later.push(r)
  }
  return { send, later, limits }
}

/**
 * Says whether one more email to someone fits today's limit. Worked out once
 * (it reads everything sent in the last day), for a job that asks about many
 * people, as the sequence engine does before each send.
 */
export function dailyRoom(now = new Date()): (email: string) => boolean {
  const limits = dailyLimits(now)
  if (!limits) return () => true
  const kind = kindResolver()
  return (email) => {
    const left = limits[kind(email)].left
    return left === null || left > 0
  }
}

export const hasDailyRoom = (email: string, now = new Date()) => dailyRoom(now)(email)

/** When a send that hit today's limit carries on: a day later, as the limit counts the last 24 hours. */
export const resumeAfterLimit = (now = new Date()) => new Date(now.getTime() + DAY_MS + 60_000).toISOString()

export { MIN_SAMPLE }
