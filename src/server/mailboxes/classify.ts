// What a message in a connected inbox is, and which sequence email (if any)
// it answers. Pure, so it can be tested with real messages' headers.
//
//   own         the sender's own mail (Gmail's All Mail holds sent mail too)
//   bounce      a delivery failure report
//   auto_reply  out-of-office and other automatic replies: not a reply, the
//               sequence carries on
//   reply       anything else, from someone, to the sender
//
// A reply is matched to an enrollment by its In-Reply-To or References (one
// of the sequence emails' Message-IDs), else by its sender's address being
// someone the sequence has emailed. A colleague replying from another
// address without quoting the thread isn't matched.

import type { InboundMessage } from './imap'

export type InboundKind = 'own' | 'bounce' | 'auto_reply' | 'reply'

const AUTO_SUBJECT =
  /^\s*(automatic reply|auto[- ]?reply|autoreply|auto[- ]?response|out of (the )?office|ooo\b|abwesenheit|abwesend|absence|r[ée]ponse automatique|respuesta autom[aá]tica|risposta automatica|automatisch antwoord|autosvar|automaattinen vastaus|i'?m away|away from (the )?office|on (annual )?leave|on holiday|on vacation)/i
const BOUNCE_SUBJECT = /^(undeliverable|undelivered mail|delivery status notification|mail delivery (failed|subsystem)|returned mail|failure notice|delivery failure|message not delivered|non[- ]?delivery)/i
const BOUNCE_FROM = /^(mailer-daemon|postmaster)@/i

const lower = (s: string | null | undefined) => (s ?? '').toLowerCase()

export function classifyInbound(m: InboundMessage, ownAddresses: string[]): InboundKind {
  const from = lower(m.from)
  if (from && ownAddresses.some((a) => lower(a) === from)) return 'own'
  const ct = lower(m.headers['content-type'])
  if (BOUNCE_FROM.test(from) || /report-type\s*=\s*"?delivery-status/.test(ct) || m.headers['x-failed-recipients'] || BOUNCE_SUBJECT.test(m.subject)) return 'bounce'
  const auto = lower(m.headers['auto-submitted'])
  if ((auto && auto !== 'no') || m.headers['x-autoreply'] || m.headers['x-autorespond'] || /auto_reply/.test(lower(m.headers.precedence))) return 'auto_reply'
  if (/^(bulk|junk|list)$/.test(lower(m.headers.precedence).trim())) return 'auto_reply'
  if (AUTO_SUBJECT.test(m.subject)) return 'auto_reply'
  return 'reply'
}

const bare = (id: string) => id.trim().replace(/^<|>$/g, '').toLowerCase()

/** What a reply can be matched against: the sequence emails' Message-IDs, and the people they went to. */
export interface ReplyIndex<E> {
  byMessageId: Map<string, E>
  /** By address: everyone emailed, with when their first email went. */
  byEmail: Map<string, { item: E; firstSentAt: string }>
}

export function buildIndex<E>(items: Array<{ item: E; email: string; messageIds: string[]; firstSentAt: string }>): ReplyIndex<E> {
  const byMessageId = new Map<string, E>()
  const byEmail = new Map<string, { item: E; firstSentAt: string }>()
  for (const { item, email, messageIds, firstSentAt } of items) {
    for (const id of messageIds) byMessageId.set(bare(id), item)
    const known = byEmail.get(email.toLowerCase())
    // The most recent enrollment for an address wins.
    if (!known || known.firstSentAt < firstSentAt) byEmail.set(email.toLowerCase(), { item, firstSentAt })
  }
  return { byMessageId, byEmail }
}

export function matchReply<E>(m: InboundMessage, index: ReplyIndex<E>): { item: E; by: 'thread' | 'from' } | null {
  for (const id of [m.inReplyTo, ...m.references].filter((x): x is string => !!x)) {
    const hit = index.byMessageId.get(bare(id))
    if (hit) return { item: hit, by: 'thread' }
  }
  const from = lower(m.from)
  const known = from ? index.byEmail.get(from) : undefined
  // Only after we'd emailed them: an older message from them isn't a reply.
  if (known && (!m.date || m.date >= known.firstSentAt)) return { item: known.item, by: 'from' }
  return null
}

/**
 * A bounce report's failed recipient, and whether it's permanent (5.x.x):
 * from its delivery-status part, else the common wording of servers that
 * send plain text.
 */
export function parseBounce(source: string): { recipient: string; hard: boolean } | null {
  const final = source.match(/^(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*<?([^\s<>;]+@[^\s<>;]+)>?/im)
  const status = source.match(/^Status:\s*([245])\.\d{1,3}\.\d{1,3}/im)
  if (final) return { recipient: final[1].toLowerCase(), hard: status ? status[1] === '5' : true }
  const failed = source.match(/^X-Failed-Recipients:\s*([^\s,]+@[^\s,]+)/im)
  if (failed) return { recipient: failed[1].toLowerCase(), hard: true }
  return null
}

const STOP =
  /^(stop|unsubscribe( me)?|remove( me)?|take me off( (your|the) list)?|opt[- ]?out|please (stop|remove me|unsubscribe( me)?)|(do not|don'?t) (contact|email) me( again)?)[\s.!]*$/i

/** Whether a reply's first words ask not to be emailed again ("stop", "unsubscribe", "remove me"…). */
export function isStopRequest(text: string): boolean {
  const first = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('>'))
  if (!first) return false
  return STOP.test(first.slice(0, 80))
}

/**
 * The plain text at the start of a raw message (its first text part,
 * decoded if quoted-printable or base64), for isStopRequest.
 */
export function leadingText(source: string): string {
  const split = source.search(/\r?\n\r?\n/)
  if (split < 0) return ''
  const head = source.slice(0, split)
  let body = source.slice(split).replace(/^\s+/, '')
  const boundary = head.match(/boundary="?([^";\r\n]+)"?/i)?.[1]
  let enc = head.match(/^Content-Transfer-Encoding:\s*(\S+)/im)?.[1]?.toLowerCase()
  if (boundary) {
    const parts = body.split(`--${boundary}`)
    const text = parts.find((p) => /content-type:\s*text\/plain/i.test(p)) ?? parts.find((p) => /content-type:\s*text\//i.test(p))
    if (!text) return ''
    const at = text.search(/\r?\n\r?\n/)
    enc = text.slice(0, at).match(/Content-Transfer-Encoding:\s*(\S+)/i)?.[1]?.toLowerCase()
    body = text.slice(at).replace(/^\s+/, '')
  }
  if (enc === 'base64') {
    try {
      body = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8')
    } catch {
      return ''
    }
  } else if (enc === 'quoted-printable') {
    body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  }
  return body.replace(/<[^>]+>/g, ' ').slice(0, 2000)
}
