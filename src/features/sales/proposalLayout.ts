// The layout a new proposal starts from: cover, summary, scope, price and
// next steps, filled in from the deal and the brand kit so it only needs
// editing, not writing from scratch. Pure, so the server can compile it.

import type { EmailBlock, GlobalStyle } from '../email-builder/types'
import { compileHTML } from '../email-builder/utils/compiler'
import { DEFAULT_GLOBAL_STYLE } from '../email-builder/utils/design'

export interface ProposalFacts {
  title: string
  /** Who it's for: their company, or the deal's name. */
  client: string
  /** Their first name, for the greeting. */
  firstName: string | null
  /** The deal's value, formatted ("£4,500"); null when it has none, which leaves a gap to fill in. */
  price: string | null
  /** From the brand kit. */
  brand: { name?: string; logoUrl?: string; primaryColor?: string; fontFamily?: string } | null
}

export function proposalBlocks(f: ProposalFacts): EmailBlock[] {
  let n = 0
  const id = () => `pr_${Date.now().toString(36)}_${(n++).toString(36)}`
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const muted = { fontSize: 13, color: '#6b7280' }
  const blocks: EmailBlock[] = [
    f.brand?.logoUrl
      ? { id: id(), type: 'logo', content: f.brand.logoUrl, alt: f.brand.name || 'Logo', align: 'left' }
      : { id: id(), type: 'logo', content: f.brand?.name || 'YOUR COMPANY', align: 'left' },
    { id: id(), type: 'text', content: `Prepared for ${f.client} · ${date}`, style: { ...muted, paddingTop: 24 } },
    { id: id(), type: 'title', content: f.title, style: { fontSize: 30, paddingTop: 4 } },
    {
      id: id(),
      type: 'text',
      content: `${f.firstName ? `Hi ${f.firstName},` : 'Hello,'}\n\nThanks for the time you've given us. This proposal sets out what we understood you need, what we'll do about it, and what it costs. If anything here doesn't match what you had in mind, reply and we'll change it.`,
      style: { paddingTop: 12 },
    },
    { id: id(), type: 'divider', content: '' },
    { id: id(), type: 'title', content: 'Where you are now', style: { fontSize: 20 } },
    { id: id(), type: 'text', content: "Describe the problem in their words: what's slowing them down, what it costs them, and why now." },
    { id: id(), type: 'title', content: "What we'll do", style: { fontSize: 20, paddingTop: 16 } },
    {
      id: id(),
      type: 'text',
      content: '• The first thing you will deliver, and what it gives them\n• The second, and when\n• What they will have at the end that they don\'t have today',
    },
    { id: id(), type: 'title', content: 'Investment', style: { fontSize: 20, paddingTop: 16 } },
    {
      id: id(),
      type: 'receipt',
      content: '',
      items: [{ id: id(), image: '', title: f.title, text: '', qty: '1', price: f.price ?? '£…' }],
      summaryRows: [{ id: id(), label: 'Total', value: f.price ?? '£…', emphasis: true }],
    },
    { id: id(), type: 'text', content: 'Prices exclude VAT. This proposal is valid for 30 days.', style: muted },
    { id: id(), type: 'title', content: 'Next steps', style: { fontSize: 20, paddingTop: 16 } },
    {
      id: id(),
      type: 'text',
      content: "Accept below and we'll send the agreement and book a kick-off call within two working days.",
    },
  ]
  return blocks
}

export function proposalStyle(brand: ProposalFacts['brand']): GlobalStyle {
  return {
    ...DEFAULT_GLOBAL_STYLE,
    bodyWidth: 680,
    canvasBgColor: '#f4f4f5',
    bodyBgColor: '#ffffff',
    paddingX: 48,
    paddingY: 48,
    lineHeight: 1.6,
    footerText: '',
    ...(brand?.primaryColor ? { buttonBgColor: brand.primaryColor, linkColor: brand.primaryColor } : {}),
    ...(brand?.fontFamily ? { fontFamily: brand.fontFamily } : {}),
  }
}

/** A new proposal's HTML, with its design embedded so the builder can edit it. */
export function proposalHtml(f: ProposalFacts): string {
  return compileHTML(proposalBlocks(f), proposalStyle(f.brand))
}
