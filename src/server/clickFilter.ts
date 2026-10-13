// Telling people's clicks and opens from automated ones. Business mail is scanned as it
// arrives (Microsoft Defender Safe Links, Mimecast, Proofpoint and the like):
// the scanner follows every link in the email within seconds, which would
// otherwise count as the recipient clicking. Seen on MagpieCRM's own
// campaigns: 41 of 42 first clicks came within five minutes of sending.
//
// A click is automated when any of these holds:
//   - the request says it's a scanner or a script (its user agent);
//   - it came within TOO_SOON_MS of the email being sent;
//   - within TRAP_WINDOW_MS of the email's hidden trap link being followed,
//     which no person can see or click (emailService.ts adds it);
//   - within BURST_MS of a click on a different link in the same email:
//     people click one link at a time, scanners all of them at once;
//   - one of RESCAN_CLICKS or more on one link, once the trap link has been
//     followed: the scanner in front of that mailbox re-checking it.
// Opens are judged the same way, except for the burst rule. Mail apps that
// load images for people (Gmail's and Yahoo's image proxies) aren't flagged
// by name, and Apple Mail loading every image as it arrives can't be told
// apart from a real open, so opens stay a guide. Only the verdict is kept,
// never the user agent itself.
//
// "Too soon" is measured from when the email reached the recipient's mail
// server, where the host says when that was (a hosted copy's mail server
// paces what it sends, so an email can be delivered minutes or an hour after
// the campaign handed it over). From then, an open inside
// OPEN_TOO_SOON_MS is the mailbox provider or a scanner loading the images as
// the email arrives: on MagpieCRM's own campaigns (2026-10), 35 of 40 "opens"
// at Google came within a minute of delivery. Without a delivery time, it's
// measured from the send, as before.

export const TOO_SOON_MS = 10_000
/** After a known delivery time, an image load this soon is the email arriving, not being read. */
export const OPEN_TOO_SOON_MS = 60_000
export const TRAP_WINDOW_MS = 60_000
export const BURST_MS = 2_000
/**
 * Some scanners keep re-checking the links they found, hours apart, with a
 * browser's user agent: seen on MagpieCRM's own campaigns (2026-10), one
 * link "clicked" 30 times over seven hours from a mailbox whose trap link was
 * followed. A person clicks a link once or twice.
 */
export const RESCAN_CLICKS = 3

/** One tracked click on one recipient's email. */
export interface ClickEvent {
  url: string | null
  at: string
  /** The request said it was a scanner or script. */
  bot?: true
}

const SCANNER_AGENT =
  /bot\b|crawl|spider|preview|scanner|python|curl|wget|go-http|java\/|okhttp|headless|phantom|libwww|httpclient|axios|node-fetch|barracuda|mimecast|proofpoint|safelinks|trendmicro|symantec|messagelabs|forcepoint|sophos|zscaler|fireeye|ironport|cisco|avanan|checkpoint/i

/** Whether a request's user agent is a scanner or script (or missing, which no browser sends). */
export function looksAutomated(userAgent: string | null | undefined): boolean {
  return !userAgent?.trim() || SCANNER_AGENT.test(userAgent)
}

/** When an email went out, for judging what came too soon after: its delivery where that's known, else its send. */
export interface SentContext {
  sentAt?: string | null
  /** When the recipient's mail server took it, where the host reports that. */
  deliveredAt?: string | null
  trappedAt?: string | null
}

/** For each click, whether it was automated. */
export function automatedClicks(events: ClickEvent[], ctx: SentContext): boolean[] {
  const time = (s: string) => Date.parse(s)
  const sent = ctx.deliveredAt ? time(ctx.deliveredAt) : ctx.sentAt ? time(ctx.sentAt) : NaN
  const trapped = ctx.trappedAt ? time(ctx.trappedAt) : NaN
  const verdicts = events.map((e, i) => {
    const at = time(e.at)
    if (e.bot) return true
    if (!Number.isNaN(sent) && at - sent < TOO_SOON_MS) return true
    if (!Number.isNaN(trapped) && Math.abs(at - trapped) <= TRAP_WINDOW_MS) return true
    return events.some((o, j) => j !== i && o.url !== e.url && Math.abs(time(o.at) - at) <= BURST_MS)
  })
  if (Number.isNaN(trapped)) return verdicts
  const perLink = new Map<string | null, number>()
  events.forEach((e, i) => !verdicts[i] && perLink.set(e.url, (perLink.get(e.url) ?? 0) + 1))
  return verdicts.map((automated, i) => automated || (perLink.get(events[i].url) ?? 0) >= RESCAN_CLICKS)
}

/** One time the email's images loaded (its open-tracking image). */
export interface OpenEvent {
  at: string
  /** The request said it was a scanner or script. */
  bot?: true
}

/**
 * For each open, whether it was automated: a scanner or script, too soon
 * after the email arrived (or, where that isn't known, was sent), or around
 * the trap link.
 */
export function automatedOpens(events: OpenEvent[], ctx: SentContext): boolean[] {
  const delivered = ctx.deliveredAt ? Date.parse(ctx.deliveredAt) : NaN
  const sent = ctx.sentAt ? Date.parse(ctx.sentAt) : NaN
  const trapped = ctx.trappedAt ? Date.parse(ctx.trappedAt) : NaN
  return events.map((e) => {
    const at = Date.parse(e.at)
    const tooSoon = !Number.isNaN(delivered) ? at - delivered < OPEN_TOO_SOON_MS : !Number.isNaN(sent) && at - sent < TOO_SOON_MS
    return Boolean(e.bot) || tooSoon || (!Number.isNaN(trapped) && Math.abs(at - trapped) <= TRAP_WINDOW_MS)
  })
}
