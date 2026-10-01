// One sequence email for one person: the step's text with their details
// filled in, the sign-off, and the unsubscribe line, as plain text (what it
// is) and as minimal HTML (the same words, links clickable) so mail clients
// that prefer HTML show it the same. Open and click tracking go in only when
// the sequence has them on; the plain-text part never carries them.

import type { SequenceSettings } from '../../features/sequences/types'
import { mergeContact, type MergeContact } from '../mergeTags'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!)

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi
const UNSUB = /\{\{\s*unsubscribe\s*\}\}/gi

/** The whole email as text, with `{{ unsubscribe }}` still in it. */
export function composeText(body: string, settings: Pick<SequenceSettings, 'signature' | 'footer'>): string {
  return [body.trim(), settings.signature.trim(), settings.footer.trim()].filter(Boolean).join('\n\n')
}

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
  const text = filled.replace(UNSUB, () => input.unsubscribeUrl)

  // HTML: the same text, escaped, line breaks kept and links made clickable.
  const link = (url: string, isUnsubscribe: boolean) => {
    const href = !isUnsubscribe && input.settings.track_clicks && tracking.clickUrl ? tracking.clickUrl(url) : url
    return `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`
  }
  const lines = filled.split(UNSUB).map((part) => {
    let out = ''
    let last = 0
    for (const m of part.matchAll(URL_RE)) {
      out += escapeHtml(part.slice(last, m.index)) + link(m[0], false)
      last = m.index! + m[0].length
    }
    return out + escapeHtml(part.slice(last))
  })
  let bodyHtml = lines.join(link(input.unsubscribeUrl, true)).replace(/\r?\n/g, '<br>\n')
  if (input.settings.track_opens && tracking.openUrl) {
    bodyHtml += `<img src="${escapeHtml(tracking.openUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${bodyHtml}</div></body></html>`
  return { subject, text, html }
}
