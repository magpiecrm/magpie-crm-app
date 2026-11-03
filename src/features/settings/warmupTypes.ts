// Inbox warmup as the Warmup page shows it (server/inboxWarmup.ts). A sender's
// warmup lives with the host; these are its answers, plus what this copy
// knows itself: whether each sender can warm yet, and why not.

export interface Tally {
  inbox: number
  tabs: number
  spam: number
}

/** One sender's warmup, as the host says. */
export interface WarmupSender {
  address: string
  state: 'starting' | 'warming' | 'paused' | 'failed'
  /** Who paused it: you, or MagpieCRM (`reason` says why). */
  pausedBy: 'you' | 'us' | null
  reason: string | null
  /** The pool's view of it: healthy, watch, throttled, quarantined or blocked, with a score out of 100. */
  health: { state: string; score: number; reason: string | null; until: string | null } | null
  today: { sent: number; target: number | null } | null
  ceiling: number | null
  daysActive: number | null
  week: { sent: number; replied: number; spam: number } | null
  /** Partners the pool has for it today, when fewer than its target. */
  partners: number | null
  problem: string | null
}

export interface WarmupSenderRow {
  senderId: number
  name: string
  email: string
  /** Why it can't warm yet, each in a sentence; empty when it can. */
  blockers: string[]
  warmup: WarmupSender | null
}

export type WarmupPage =
  | { offered: false }
  | {
      offered: true
      /** Set while MagpieCRM has stopped all of this workspace's warmup. */
      stopped: string | null
      maxSenders: number
      senders: WarmupSenderRow[]
      placementTests: { used: number; limit: number }
      consent: { version: string; points: string[] }
      /** The warmup service couldn't be reached: the senders are shown without their warmup. */
      error?: string
    }

export interface WarmupPlacement {
  /** Each sender's last 7 days: at Google, Microsoft and Yahoo (major), and everywhere (all). */
  senders: Array<{ address: string; major: Tally; all: Tally }>
  /** Day by day, per provider group: google, microsoft, yahoo, other. */
  daily: Array<Tally & { date: string; group: string }>
}

export interface WarmupDay {
  date: string
  sent: number
  replied: number
  received: number
  target: number
}

export interface PlacementTestResult {
  id: string
  status: string
  startedAt: string
  /** By mail provider: where the copies landed, and how many have no answer yet. */
  families: Array<Tally & { family: string; missing: number; waiting: number }>
}
