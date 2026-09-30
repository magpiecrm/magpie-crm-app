// Telling people's clicks from automated ones. Business mail is scanned as it
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
//     people click one link at a time, scanners all of them at once.
// Only the verdict is kept, never the user agent itself.

export const TOO_SOON_MS = 10_000
export const TRAP_WINDOW_MS = 60_000
export const BURST_MS = 2_000

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
  return events.map((e, i) => {
    const at = time(e.at)
    if (e.bot) return true
    if (!Number.isNaN(sent) && at - sent < TOO_SOON_MS) return true
    if (!Number.isNaN(trapped) && Math.abs(at - trapped) <= TRAP_WINDOW_MS) return true
    return events.some((o, j) => j !== i && o.url !== e.url && Math.abs(time(o.at) - at) <= BURST_MS)
  })
}
