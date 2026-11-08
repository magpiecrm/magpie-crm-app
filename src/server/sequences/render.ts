// One sequence email for one person: the step's text with their details
// filled in, the sign-off, and the unsubscribe line, as plain text (what it
// is) and as minimal HTML (the same words, links clickable) so mail clients
// that prefer HTML show it the same. Open and click tracking go in only when
// the sequence has them on; the plain-text part never carries them.

import { createHash } from 'node:crypto'
import type { SequenceSettings } from '../../features/sequences/types'
import { mergeContact, type MergeContact } from '../mergeTags'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!)

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi
const UNSUB = /\{\{\s*unsubscribe\s*\}\}/gi

/**
 * What `{{ unsubscribe }}` says: words that link, rather than its long
 * address. Not "click here", which spam filters (and spamScore) mark down.
 * Capitalised where it starts a sentence.
 */
export function unsubscribeWords(before: string): string {
  return /(^|[.!?])\s*$/.test(before) ? 'Unsubscribe here' : 'unsubscribe here'
}

/** The whole email as text, with `{{ unsubscribe }}` still in it. */
export function composeText(body: string, settings: Pick<SequenceSettings, 'signature' | 'footer'>): string {
  return [body.trim(), settings.signature.trim(), settings.footer.trim()].filter(Boolean).join('\n\n')
}

/** A short fingerprint of an email's words as written (composeText, before merge tags), to tell later whether the step changed since. */
export const textHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** Text as HTML: escaped, line breaks kept, addresses clickable. */
export function textToHtml(text: string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    out += escapeHtml(text.slice(last, m.index)) + `<a href="${escapeHtml(m[0])}">${escapeHtml(m[0])}</a>`
    last = m.index! + m[0].length
  }
  return (out + escapeHtml(text.slice(last))).replace(/\r?\n/g, '<br>\n')
}

/** A whole HTML email around a body, in the plain style sequence emails have. */
export const htmlDocument = (body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${body}</div></body></html>`

export interface RenderedStep {
  subject: string
  text: string
  html: string
}

export function renderStep(
  input: {
    subject: string
    body: string
    contact: MergeContact
    settings: Pick<SequenceSettings, 'signature' | 'footer' | 'track_opens' | 'track_clicks'>
    unsubscribeUrl: string
  },
  tracking: { openUrl?: string; clickUrl?: (url: string) => string } = {},
): RenderedStep {
  const subject = mergeContact(input.subject, input.contact, { html: false })
  const filled = mergeContact(composeText(input.body, input.settings), input.contact, { html: false })
  // Plain text can't link words, so the address follows them there (none in a preview, which has no address).
  const parts = filled.split(UNSUB)
  const text = parts.reduce((out, part, i) => out + unsubscribeWords(parts[i - 1]) + (input.unsubscribeUrl ? ` (${input.unsubscribeUrl})` : '') + part)

  // HTML: the same text, escaped, line breaks kept and links made clickable.
  const link = (url: string) => {
    const href = input.settings.track_clicks && tracking.clickUrl ? tracking.clickUrl(url) : url
    return `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`
  }
  const lines = parts.map((part) => {
    let out = ''
    let last = 0
    for (const m of part.matchAll(URL_RE)) {
      out += escapeHtml(part.slice(last, m.index)) + link(m[0])
      last = m.index! + m[0].length
    }
    return out + escapeHtml(part.slice(last))
  })
  const unsubscribeLink = (words: string) => `<a href="${escapeHtml(input.unsubscribeUrl)}">${escapeHtml(words)}</a>`
  let bodyHtml = lines.reduce((out, line, i) => out + unsubscribeLink(unsubscribeWords(parts[i - 1])) + line).replace(/\r?\n/g, '<br>\n')
  if (input.settings.track_opens && tracking.openUrl) {
    bodyHtml += `<img src="${escapeHtml(tracking.openUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`
  }
  return { subject, text, html: htmlDocument(bodyHtml) }
}
