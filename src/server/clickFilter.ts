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
// load images for people (Gmail's and Yahoo's image proxies) aren't flagged,
// and Apple Mail loading every image as it arrives can't be told apart from a
// real open, so opens stay a guide. Only the verdict is kept, never the user
// agent itself.

export const TOO_SOON_MS = 10_000
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

/** For each click, whether it was automated. */
export function automatedClicks(events: ClickEvent[], ctx: { sentAt?: string | null; trappedAt?: string | null }): boolean[] {
  const time = (s: string) => Date.parse(s)
  const sent = ctx.sentAt ? time(ctx.sentAt) : NaN
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

/** For each open, whether it was automated: a scanner or script, too soon after sending, or around the trap link. */
export function automatedOpens(events: OpenEvent[], ctx: { sentAt?: string | null; trappedAt?: string | null }): boolean[] {
  const sent = ctx.sentAt ? Date.parse(ctx.sentAt) : NaN
  const trapped = ctx.trappedAt ? Date.parse(ctx.trappedAt) : NaN
  return events.map((e) => {
    const at = Date.parse(e.at)
    return Boolean(e.bot) || (!Number.isNaN(sent) && at - sent < TOO_SOON_MS) || (!Number.isNaN(trapped) && Math.abs(at - trapped) <= TRAP_WINDOW_MS)
  })
}
