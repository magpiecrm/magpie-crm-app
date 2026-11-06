// Who an email goes to: mail to people who don't know the sender, and to
// addresses that were guessed or can't be checked, is what drives bounces and
// spam complaints. Counts only; nothing here names anyone.

import type { SpamFinding } from '../../features/spam-score/types'

export interface RecipientsInput {
  /** Subscribed people it would go to. */
  total: number
  /** Of them, found by prospecting and not signed up or replied. */
  cold: number
  /** Prospected addresses that weren't verified (guessedRecipients.ts holds most back). */
  unconfirmed: number
  /** At companies whose mail server accepts every address, so they couldn't be checked. */
  catchAll: number
  /** Today's cold sending limit, where the host's mail server sends. */
  coldLimit: { limit: number; left: number } | null
}

export const RECIPIENT_POINTS = {
  mostlyCold: 15,
  someUnconfirmed: 8,
  manyUnconfirmed: 15,
  manyCatchAll: 6,
}

const share = (n: number, of: number) => `${Math.round((n / of) * 100)}%`

/** More than half cold counts as a cold send (content.ts holds cold email to plainer rules). */
export const isColdSend = (r: RecipientsInput) => r.total > 0 && r.cold / r.total >= 0.5

export function recipientFindings(r: RecipientsInput): SpamFinding[] {
  const out: SpamFinding[] = []
  const add = (code: string, points: number, text: string, fix: string) => out.push({ code, part: 'recipients', points, fixable: false, text, fix })
  if (!r.total) return out

  if (isColdSend(r)) {
    add('mostly_cold', RECIPIENT_POINTS.mostlyCold, `${share(r.cold, r.total)} of the recipients are cold: people who haven't heard from you before.`, 'Cold email does best short, plain and personal, sent a little at a time.')
  }
  if (r.unconfirmed / r.total >= 0.3) {
    add('many_unconfirmed', RECIPIENT_POINTS.manyUnconfirmed, `${share(r.unconfirmed, r.total)} of the recipients' addresses weren't verified. Bounces from them count against you with every inbox.`, 'Send to verified addresses first; the rest are held back until their bounces are in.')
  } else if (r.unconfirmed / r.total >= 0.1) {
    add('some_unconfirmed', RECIPIENT_POINTS.someUnconfirmed, `${share(r.unconfirmed, r.total)} of the recipients' addresses weren't verified, so some may bounce.`, 'Send to verified addresses first; the rest are held back until their bounces are in.')
  }
  if (r.catchAll / r.total >= 0.3) {
    add('many_catch_all', RECIPIENT_POINTS.manyCatchAll, `${share(r.catchAll, r.total)} of the recipients are at companies that accept every address, so they couldn't be checked.`, 'Expect some bounces; leave out those you can.')
  }
  if (r.coldLimit && r.cold > r.coldLimit.left && r.coldLimit.limit > 0) {
    const days = Math.ceil((r.cold - r.coldLimit.left) / r.coldLimit.limit) + (r.coldLimit.left > 0 ? 1 : 0)
    add('daily_limit', 0, `Today's cold sending limit has room for ${r.coldLimit.left} of the ${r.cold} cold emails, so they go out over about ${days} days.`, 'Nothing to do: the rest follow by themselves.')
  }
  return out
}
