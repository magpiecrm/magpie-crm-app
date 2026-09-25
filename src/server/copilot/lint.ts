import type { EmailBlock } from '../../features/email-builder/types'

export interface LintIssue {
  severity: 'error' | 'warning'
  /** Block the issue belongs to, when it is attributable to one. */
  blockId?: string
  message: string
}

/** Gmail clips messages past this size, hiding everything after the cut. */
const GMAIL_CLIP_BYTES = 102_400

/**
 * CSS that Outlook 2007-2019 silently drops, because it renders with the Word
 * engine. Only checked inside `html` blocks and raw style strings — the
 * compiler already avoids these in the markup it generates itself.
 */
const UNSUPPORTED_CSS = [
  'position:',
  'float:',
  'flex',
  'grid',
  'max-width:',
  'box-shadow:',
  'transform:',
]

/**
 * Check a compiled design for the mistakes that actually break emails in the
 * wild. Exposed to the copilot as `compileEmail` so it can iterate against real
 * feedback rather than guessing whether its output is sound.
 */
export function lintEmail(blocks: EmailBlock[], html: string): LintIssue[] {
  const issues: LintIssue[] = []

  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes > GMAIL_CLIP_BYTES) {
    issues.push({
      severity: 'warning',
      message: `Compiled email is ${Math.round(bytes / 1024)}KB; Gmail clips above 102KB and hides the rest behind a "View entire message" link.`,
    })
  }

  if (!/\{\{\s*unsubscribe\s*\}\}/i.test(html)) {
    issues.push({
      severity: 'error',
      message: 'No {{ unsubscribe }} link. Bulk marketing email requires one — add a footer block or a link using that token.',
    })
  }

  for (const block of blocks) {
    const b = block as any

    if (b.type === 'image' || b.type === 'logo') {
      if (!b.alt?.trim()) {
        issues.push({
          severity: 'warning',
          blockId: b.id,
          message: `${b.type} block has no alt text. Most clients block images by default, so alt text is what the recipient actually sees first.`,
        })
      }
      if (!b.content?.trim()) {
        issues.push({ severity: 'error', blockId: b.id, message: `${b.type} block has no image URL.` })
      }
    }

    if (Array.isArray(b.items)) {
      for (const item of b.items) {
        if (item?.image && !item?.alt?.trim()) {
          issues.push({
            severity: 'warning',
            blockId: b.id,
            message: `A cell in this ${b.type} block has an image with no alt text.`,
          })
        }
      }
    }

    if (b.type === 'button' && !b.url?.trim()) {
      issues.push({ severity: 'error', blockId: b.id, message: 'Button block has no destination URL.' })
    }

    if (b.type === 'html' && typeof b.content === 'string') {
      const found = UNSUPPORTED_CSS.filter(prop => b.content.toLowerCase().includes(prop))
      if (found.length > 0) {
        issues.push({
          severity: 'warning',
          blockId: b.id,
          message: `Raw HTML block uses ${found.join(', ')} — Outlook's Word engine drops these. Prefer native blocks, or table-based layout with inline styles.`,
        })
      }
    }
  }

  return issues
}
