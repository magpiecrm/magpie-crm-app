// An email's new words apart from the earlier ones it quotes, so a
// conversation shows each message once: the "On … wrote:" line and what
// follows it (Gmail, Apple Mail, and their translations), Outlook's
// "From: … Sent: …" block, "-----Original Message-----", and a closing run
// of lines starting ">".

export interface SplitText {
  /** What they wrote. */
  body: string
  /** The earlier emails it quotes, from the line that introduces them; empty if none. */
  quoted: string
}

const WROTE = [
  /^On\b.{0,300}\bwrote:\s*$/i,
  /^Le\b.{0,300}\ba écrit\s?:\s*$/i,
  /^Am\b.{0,300}\bschrieb\b.{0,200}:\s*$/i,
  /^El\b.{0,300}\bescribió:\s*$/i,
  /^Il giorno\b.{0,300}\bha scritto:\s*$/i,
  /^Op\b.{0,300}\bschreef\b.{0,200}:\s*$/i,
]
const ORIGINAL = /^-{2,}\s*(Original Message|Forwarded message|Ursprüngliche Nachricht|Message d'origine)\s*-{2,}/i
const RULE = /^_{10,}\s*$/
const HEADER = /^\*?(From|De|Von|Van|Da):\*?\s/i
const SENT = /^\*?(Sent|Date|Envoyé|Gesendet|Verzonden|Inviato|Enviado):\*?\s/i

/** Whether the quoted part starts at line `i`. */
function startsQuote(lines: string[], i: number): boolean {
  const line = lines[i].trim()
  // A long "On … wrote:" line can wrap onto the next.
  const joined = `${line} ${lines[i + 1]?.trim() ?? ''}`.trim()
  if (WROTE.some((re) => re.test(line) || (/^(On|Le|Am|El|Il giorno|Op)\b/i.test(line) && re.test(joined)))) return true
  if (ORIGINAL.test(line)) return true
  // Outlook: an optional rule, then From: with Sent: or Date: within the next few lines.
  const from = RULE.test(line) ? i + 1 : i
  if (HEADER.test(lines[from]?.trim() ?? '')) return lines.slice(from + 1, from + 5).some((l) => SENT.test(l.trim()))
  return false
}

export function splitQuoted(text: string): SplitText {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let cut = lines.findIndex((_, i) => startsQuote(lines, i))
  if (cut < 0) {
    // No introducing line: only a closing run of ">" lines (and blanks) counts as quoted.
    let i = lines.length
    while (i > 0 && (lines[i - 1].trim() === '' || lines[i - 1].trimStart().startsWith('>'))) i--
    if (i < lines.length && lines.slice(i).some((l) => l.trimStart().startsWith('>'))) cut = i
  }
  if (cut < 0) return { body: text.trim(), quoted: '' }
  const body = lines.slice(0, cut).join('\n').trim()
  // All quote and nothing new (a forward, say): show it all.
  if (!body) return { body: text.trim(), quoted: '' }
  return { body, quoted: lines.slice(cut).join('\n').trim() }
}

/** The start of what they wrote, on one line, for a list. */
export function snippet(text: string, max = 140): string {
  const flat = splitQuoted(text).body.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}
