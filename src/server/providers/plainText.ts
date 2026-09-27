// A plain-text version of an email's HTML, sent alongside it: mail with only
// HTML scores worse with spam filters, and some people read text only.

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·' }

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Links keep their address, unless the text already is it.
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = decode(inner.replace(/<[^>]+>/g, '')).trim()
      const url = decode(href).trim()
      if (!label) return url
      return label === url || url.startsWith('mailto:') || url.startsWith('#') ? label : `${label} (${url})`
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol|blockquote|section|header|footer)>/gi, '\n\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<hr\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
  return decode(text)
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
