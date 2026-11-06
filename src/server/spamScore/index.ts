// The spam score: before a campaign or sequence goes out, an estimate of how
// likely it is to land in spam, out of 100, with what to change. Three parts,
// each a list of findings with points:
//
//   content.ts     what the email says, its links, images and tracking
//   sender.ts      the From domain: DKIM/SPF/DMARC, blocklists, reputation, warmup
//   recipients.ts  who it goes to: cold, unverified, catch-all
//
// Points add up (to 100 at most): under 25 is low, 25 to 59 medium, 60 and
// over high, and some findings (a blocklisted domain, a poor reputation…) make
// it high on their own. It's an estimate: mailbox providers decide for
// themselves, and only a placement test (the Warmup page's sender check)
// measures where mail really lands. Nothing is stored; counts only.

import { db, type DbSchema } from '../db'
import { env } from '../env'
import { withoutBuilderData } from '../emailService'
import { canSendFrom } from '../sendingDomains'
import { domainReputations, kindResolver, type Reputation } from '../sendingReputation'
import { dailyLimits } from '../sendingLimits'
import { isUnconfirmedGuess } from '../prospecting/types'
import { getActiveProviderConfig } from '../emailSettings'
import { authRecords, dblListed, type DnsAuthDeps } from '../dnsAuth'
import { warmupOffered, warmupStanding } from '../inboxWarmup'
import { composeText } from '../sequences/render'
import { levelOf, SPAM_LEVELS, type SpamFinding, type SpamScore, type SpamStepScore } from '../../features/spam-score/types'
import type { SequenceSettings, SequenceStep } from '../../features/sequences/types'
import { contentFindings, linkHosts, type ContentInput } from './content'
import { senderFindings } from './sender'
import { isColdSend, recipientFindings, type RecipientsInput } from './recipients'

/** Worst first: what makes it high on its own, then by points; notes last. */
const byWeight = (a: SpamFinding, b: SpamFinding) => Number(Boolean(b.hard)) - Number(Boolean(a.hard)) || b.points - a.points

/** The score and level these findings add up to. */
export function combine(findings: SpamFinding[]): { score: number; level: SpamScore['level']; findings: SpamFinding[] } {
  const sum = Math.min(100, findings.reduce((n, f) => n + f.points, 0))
  const score = findings.some((f) => f.hard) ? Math.max(sum, SPAM_LEVELS.high) : sum
  return { score, level: levelOf(score), findings: [...findings].sort(byWeight) }
}

// Free mailboxes, and the mail server name that means one is sent through its own provider (which is fine).
const FREE_MAIL: Record<string, RegExp> = {
  'gmail.com': /gmail|google/, 'googlemail.com': /gmail|google/,
  'outlook.com': /office365|outlook|hotmail|live\.com/, 'hotmail.com': /office365|outlook|hotmail|live\.com/,
  'hotmail.co.uk': /office365|outlook|hotmail|live\.com/, 'live.com': /office365|outlook|hotmail|live\.com/,
  'live.co.uk': /office365|outlook|hotmail|live\.com/, 'msn.com': /office365|outlook|hotmail|live\.com/,
  'yahoo.com': /yahoo/, 'yahoo.co.uk': /yahoo/, 'ymail.com': /yahoo/, 'aol.com': /aol/,
  'icloud.com': /icloud|me\.com/, 'me.com': /icloud|me\.com/, 'mac.com': /icloud|me\.com/,
  'proton.me': /proton/, 'protonmail.com': /proton/, 'gmx.com': /gmx/, 'gmx.net': /gmx/, 'gmx.de': /gmx/,
  'mail.com': /mail\.com/, 'yandex.com': /yandex/, 'yandex.ru': /yandex/, 'zohomail.com': /zoho/,
}

/** A free mailbox's address sent through a server that isn't its provider's. */
function freeMailElsewhere(domain: string): boolean {
  const own = FREE_MAIL[domain]
  if (!own) return false
  if (env.sendingManaged()) return true
  const config = getActiveProviderConfig()
  return !(config.providerId === 'smtp' && own.test(String(config.creds.host ?? '').toLowerCase()))
}

// What the score asks of other parts of the app on each keystroke is kept briefly.
const CACHE_MS = 60_000
let reputations: { at: number; byDomain: Map<string, Reputation> } | null = null
let standing: { at: number; byAddress: Awaited<ReturnType<typeof warmupStanding>> } | null = null

function reputationOf(domain: string): Reputation | null {
  if (!reputations || Date.now() - reputations.at > CACHE_MS) {
    reputations = { at: Date.now(), byDomain: new Map(domainReputations().map(({ domain: d, ...rep }) => [d, rep])) }
  }
  return reputations.byDomain.get(domain) ?? null
}

async function warmupOf(address: string) {
  if (!warmupOffered()) return null
  if (!standing || Date.now() - standing.at > 5 * CACHE_MS) standing = { at: Date.now(), byAddress: await warmupStanding().catch(() => ({})) }
  return standing.byAddress[address] ?? null
}

/** The people a send would reach, counted. */
function recipientsOf(data: DbSchema, emails: Iterable<string>): RecipientsInput {
  const wanted = new Set(emails)
  const people = data.contacts.filter((c) => wanted.has(c.email) && c.status === 'subscribed')
  const kind = kindResolver()
  const limits = dailyLimits()
  const cold = limits?.cold
  return {
    total: people.length,
    cold: people.filter((c) => kind(c.email) === 'cold').length,
    unconfirmed: people.filter(isUnconfirmedGuess).length,
    catchAll: people.filter((c) => c.email_status === 'catch_all_likely').length,
    coldLimit: cold && cold.limit !== null && cold.left !== null ? { limit: cold.limit, left: cold.left } : null,
  }
}

/** The sender's findings, or none until a sender is chosen. */
async function senderPart(senderId: number | null | undefined, linkedTo: string[], cold: boolean, deps: DnsAuthDeps): Promise<SpamFinding[]> {
  const sender = db.data.senders.find((s) => s.id === senderId)
  if (!sender) return []
  const email = sender.email.trim().toLowerCase()
  const domain = email.split('@')[1] ?? ''
  if (!domain) return []
  const [dns, dbl, warmup] = await Promise.all([authRecords(domain, deps), dblListed([domain, ...linkedTo].slice(0, 12), deps), warmupOf(email)])
  return senderFindings({
    fromEmail: email,
    managed: env.sendingManaged(),
    domainReady: canSendFrom(email),
    dns,
    dbl,
    freeMail: freeMailElsewhere(domain),
    reputation: reputationOf(domain),
    warmup,
    cold,
  })
}

export interface CampaignDraft {
  subject: string
  previewText?: string | null
  htmlContent: string
  senderId?: number | null
  listId?: number | null
  trackOpens: boolean
  unsubscribeEnabled: boolean
}

export async function campaignSpamScore(draft: CampaignDraft, deps: DnsAuthDeps = {}): Promise<SpamScore> {
  const data = db.data
  const listed = draft.listId == null ? [] : data.list_contacts.filter((lc) => lc.list_id === draft.listId).map((lc) => lc.contact_email)
  const recipients = recipientsOf(data, listed)
  const cold = isColdSend(recipients)
  const content: ContentInput = {
    kind: 'campaign',
    subject: draft.subject,
    previewText: draft.previewText,
    html: withoutBuilderData(draft.htmlContent ?? ''),
    cold,
    trackOpens: draft.trackOpens,
    // Always on for campaigns.
    trackClicks: true,
    // The host's mail server adds the link whatever the switch says (emailService.ts).
    unsubscribe: draft.unsubscribeEnabled || env.sendingManaged(),
  }
  const findings = [
    ...contentFindings(content),
    ...(await senderPart(draft.senderId, linkHosts(content), cold, deps)),
    ...recipientFindings(recipients),
  ]
  return { ...combine(findings), senderCheck: warmupOffered() }
}

export interface SequenceDraft {
  steps?: Array<Pick<SequenceStep, 'subject' | 'body'>>
  settings?: Partial<SequenceSettings>
}

export async function sequenceSpamScore(id: string, draft: SequenceDraft = {}, deps: DnsAuthDeps = {}): Promise<SpamScore> {
  const data = db.data
  const s = data.sequences?.find((x) => x.id === id)
  if (!s) throw new Error('Sequence not found')
  const steps = draft.steps ?? s.steps
  const settings = { ...s.settings, ...draft.settings }

  // Who it still has to email: those in progress, or everyone enrolled before it starts.
  const enrolled = (data.sequence_enrollments ?? []).filter((e) => e.sequence_id === id)
  const current = enrolled.filter((e) => e.status === 'active' || e.status === 'paused')
  const recipients = recipientsOf(data, (current.length ? current : enrolled).map((e) => e.contact_email))
  const cold = isColdSend(recipients)

  const contents: ContentInput[] = steps.map((st, i) => ({
    kind: 'sequence',
    // The first email always has a subject; a follow-up without one replies in its thread.
    subject: i === 0 ? (st.subject ?? '') : st.subject,
    text: composeText(st.body, settings),
    cold,
    trackOpens: settings.track_opens,
    trackClicks: settings.track_clicks,
    unsubscribe: /\{\{\s*unsubscribe\s*\}\}/i.test(settings.footer),
  }))
  const shared = [
    ...(await senderPart(s.sender_id, [...new Set(contents.flatMap(linkHosts))], cold, deps)),
    ...recipientFindings(recipients),
  ]
  const scored: SpamStepScore[] = contents.map((c, i) => {
    const own = contentFindings(c).map((f) => ({ ...f, step: i + 1 }))
    const { score, level } = combine([...own, ...shared])
    return { step: i + 1, score, level, findings: own.sort(byWeight) }
  })
  const worst = scored.reduce<SpamStepScore | null>((w, st) => (!w || st.score > w.score ? st : w), null)
  return { ...combine([...(worst?.findings ?? []), ...shared]), steps: scored, senderCheck: warmupOffered() }
}
