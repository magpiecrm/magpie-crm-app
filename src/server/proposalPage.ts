// The page a proposal's link shows (routes/p/$token.ts): its design as the
// builder compiled it, with the reader's details filled in, and a form at the
// end to accept it. It runs no scripts, and the headers keep it that way
// (PAGE_HEADERS), since its HTML is whatever the team designed.

import type { Proposal } from '../features/sales/types'

export const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy':
    "default-src 'none'; img-src * data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]!)

export interface PageReader {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  email?: string | null
}

/** Fills in contact merge tags with the reader's details, and drops an email's unsubscribe link. */
export function personalise(html: string, reader: PageReader | null): string {
  const v = (s: string | null | undefined) => escapeHtml(s ?? '')
  return html
    .replace(/<!-- BLOCKS_DATA: [\s\S]*? -->/, '')
    .replace(/\{\{\s*contact\.(first_name|FIRSTNAME)\s*\}\}/gi, () => v(reader?.first_name))
    .replace(/\{\{\s*contact\.(last_name|LASTNAME)\s*\}\}/gi, () => v(reader?.last_name))
    .replace(/\{\{\s*contact\.COMPANY\s*\}\}/gi, () => v(reader?.company))
    .replace(/\{\{\s*contact\.EMAIL\s*\}\}/gi, () => v(reader?.email))
    .replace(/\{\{\s*contact\.custom\.[a-z0-9_]+\s*\}\}/gi, '')
    .replace(/\{\{\s*unsubscribe\s*\}\}/gi, '#')
}

/** The brand colour when it's a plain hex colour, since it goes into a style attribute. */
const safeColor = (c: string | null | undefined) => (c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#111827')

const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

function acceptSection(p: Proposal, opts: { color: string; error?: string | null; preview: boolean }): string {
  if (p.accepted_at) {
    return `<section class="mp-accept" aria-live="polite"><p class="mp-done">&#10003; Accepted by ${escapeHtml(p.accepted_by ?? '')} on ${when(p.accepted_at)}</p></section>`
  }
  return `<section class="mp-accept">
  <form method="post" class="mp-form">
    <h2>Accept this proposal</h2>
    <p class="mp-note">Type your name to accept it. We'll be in touch with the next steps.</p>
    <div class="mp-row">
      <label for="mp-name" class="mp-sr">Your name</label>
      <input id="mp-name" name="name" autocomplete="name" maxlength="200" required placeholder="Your full name">
      <button type="submit" style="background:${opts.color}">Accept proposal</button>
    </div>
    ${opts.error ? `<p class="mp-error" role="alert">${escapeHtml(opts.error)}</p>` : ''}
    ${opts.preview ? '<p class="mp-note">This is your preview: accepting here would accept it for them.</p>' : ''}
  </form>
</section>`
}

const STYLE = `<style>
.mp-accept{max-width:680px;margin:24px auto 48px;padding:0 16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111827}
.mp-form{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}
.mp-form h2{margin:0 0 4px;font-size:18px}
.mp-note{margin:0 0 16px;font-size:14px;color:#6b7280}
.mp-row{display:flex;gap:8px;flex-wrap:wrap}
.mp-row input{flex:1 1 220px;min-width:0;font:inherit;font-size:16px;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px}
.mp-row button{font:inherit;font-size:15px;font-weight:600;color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer}
.mp-error{margin:12px 0 0;font-size:14px;color:#b91c1c}
.mp-done{margin:0;padding:16px 20px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;color:#065f46;font-weight:600}
.mp-preview{position:sticky;top:0;z-index:10;margin:0;padding:8px 16px;background:#111827;color:#fff;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center}
.mp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style>`

/** The proposal's page. `preview`: someone from the team is looking, which isn't counted. */
export function proposalPage(
  p: Proposal,
  opts: { reader: PageReader | null; color?: string | null; preview: boolean; error?: string | null },
): string {
  const color = safeColor(opts.color)
  let html = personalise(p.html, opts.reader)
  const head = `<title>${escapeHtml(p.title)}</title><meta name="robots" content="noindex, nofollow"><meta name="viewport" content="width=device-width, initial-scale=1">${STYLE}`
  const banner = opts.preview ? `<p class="mp-preview">Preview. Opens by your team aren't counted.</p>` : ''
  const accept = acceptSection(p, { color, error: opts.error, preview: opts.preview })
  // The builder's HTML is a whole document; anything else gets wrapped in one.
  if (!/<body[^>]*>/i.test(html)) html = `<!DOCTYPE html><html><head></head><body>${html}</body></html>`
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '')
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, () => `${head}</head>`) : html.replace(/<body[^>]*>/i, (m) => `<head>${head}</head>${m}`)
  html = html.replace(/<body[^>]*>/i, (m) => `${m}${banner}`)
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${accept}</body>`) : html + accept
  return html
}

export function notFoundPage(): string {
  return `<!DOCTYPE html><html><head><title>Proposal not found</title><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;background:#f4f4f5">
<main style="max-width:480px;margin:15vh auto;padding:0 16px;text-align:center"><h1 style="font-size:22px">This proposal isn't available</h1>
<p style="color:#6b7280">The link may be mistyped, or the proposal has been withdrawn. Ask whoever sent it for a new link.</p></main></body></html>`
}

/** The email a proposal goes out in: the message, then a button to open it. */
export function proposalEmail(message: string, url: string, title: string, brandColor?: string | null): string {
  const color = safeColor(brandColor)
  const paragraphs = message
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">
${paragraphs}
<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Open ${escapeHtml(title)}</a></p>
<p style="margin:0;font-size:13px;color:#6b7280">Or paste this link into your browser: ${escapeHtml(url)}</p>
</body></html>`
}
