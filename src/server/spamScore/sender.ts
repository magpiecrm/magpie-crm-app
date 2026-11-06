// Who an email comes from, as mailbox providers judge it: whether its domain
// proves the mail is its own (DKIM, SPF, DMARC), whether it's blocklisted, and
// how its recent mail was received (sendingReputation.ts) and its warmup is
// going. Nothing here can be fixed by editing the email.

import type { SpamFinding } from '../../features/spam-score/types'
import type { Reputation } from '../sendingReputation'
import type { WarmupSender } from '../../features/settings/warmupTypes'

export interface SenderInput {
  fromEmail: string
  /** The host runs sending (its records cover DKIM and the bounce address's SPF). */
  managed: boolean
  /** With managed sending: the domain's records are in place. */
  domainReady: boolean
  dns: { spf: boolean; dmarc: boolean }
  /** Spamhaus DBL: the From domain and the domains the email links to. */
  dbl: { checked: boolean; listed: string[] }
  /** A free mailbox's address (gmail.com…) sent through someone else's server. */
  freeMail: boolean
  /** This domain's last week of sending; null when it hasn't sent. */
  reputation: Reputation | null
  warmup: Pick<WarmupSender, 'state' | 'health' | 'problem'> | null
  cold: boolean
}

export const SENDER_POINTS = {
  noSpf: 15,
  noDmarc: 10,
  atRisk: 15,
  lowGoogleOpens: 10,
  newSender: 10,
  warmupThrottled: 10,
}

export function senderFindings(input: SenderInput): SpamFinding[] {
  const out: SpamFinding[] = []
  const add = (code: string, points: number, text: string, fix: string, hard = false) =>
    out.push({ code, part: 'sender', points, fixable: false, text, fix, ...(hard ? { hard } : {}) })
  const domain = input.fromEmail.split('@')[1]?.toLowerCase() ?? ''

  if (input.freeMail) {
    add(
      'free_mail',
      0,
      `It's sent from a ${domain} address through another server. ${domain}'s DMARC policy tells inboxes to reject or spam mail like that.`,
      'Send from an address at your own domain.',
      true,
    )
  }
  if (input.managed && !input.domainReady) {
    add('domain_not_ready', 0, `${domain} isn't ready to send from yet: without its DNS records, mail from it isn't signed (DKIM).`, 'Finish it under Settings → Sending.', true)
  }
  // With the host's mail server, SPF is checked on its bounce address, not on the From domain.
  if (!input.managed && !input.freeMail && !input.dns.spf) {
    add('no_spf', SENDER_POINTS.noSpf, `${domain} has no SPF record, so inboxes can't tell your mail server is allowed to send for it.`, "Add the SPF record your mail provider gives you to the domain's DNS.")
  }
  if (!input.freeMail && !input.dns.dmarc) {
    add('no_dmarc', SENDER_POINTS.noDmarc, `${domain} has no DMARC record. Gmail and Yahoo require one from anyone sending in bulk.`, 'Add a DMARC record (v=DMARC1; p=none to start) to its DNS.')
  }
  if (input.dbl.listed.length) {
    const own = input.dbl.listed.includes(domain)
    add(
      'blocklisted',
      0,
      own
        ? `${domain} is on the Spamhaus domain blocklist: most mail servers refuse or spam mail from it.`
        : `The email links to ${input.dbl.listed.join(', ')}, which ${input.dbl.listed.length === 1 ? 'is' : 'are'} on the Spamhaus domain blocklist.`,
      own ? 'Send from another domain, and ask Spamhaus to delist this one.' : 'Remove links to blocklisted sites.',
      true,
    )
  }

  const rep = input.reputation
  if (rep?.status === 'poor') {
    add('reputation_poor', 0, `Mail from ${domain} has been received badly this week: ${rep.reasons[0]?.text ?? ''}`.trim(), rep.reasons[0]?.fix ?? 'Send less, to people who expect it.', true)
  } else if (rep?.status === 'at_risk') {
    const top = rep.reasons.find((r) => r.code !== 'opens_google') ?? rep.reasons[0]
    add('reputation_at_risk', SENDER_POINTS.atRisk, `Mail from ${domain} is at risk this week: ${top?.text ?? ''}`.trim(), top?.fix ?? 'Send less, to people who expect it.')
  }
  const google = rep?.reasons.find((r) => r.code === 'opens_google')
  if (google && rep?.status !== 'poor') {
    add('low_google_opens', SENDER_POINTS.lowGoogleOpens, `Gmail is probably putting it in spam: ${google.text}`, google.fix)
  }
  if (input.cold && (!rep || rep.status === 'unknown')) {
    add('new_sender', SENDER_POINTS.newSender, `${domain} has little sending history yet, so inboxes don't know it.`, 'Start with small sends to people likely to reply; warmup helps too.')
  }

  const health = input.warmup?.health?.state
  if (health === 'quarantined' || health === 'blocked') {
    add('warmup_trouble', 0, `This sender's warmup is ${health}: its mail is landing in spam.`, input.warmup?.health?.reason ?? 'See Settings → Warmup.', true)
  } else if (health === 'throttled') {
    add('warmup_throttled', SENDER_POINTS.warmupThrottled, "This sender's warmup has been slowed down because some of it lands in spam.", input.warmup?.health?.reason ?? 'See Settings → Warmup.')
  }
  return out
}
