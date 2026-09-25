import type { SurveyEmailSnapshot } from '../survey-builder/utils/emailSnippet'
export type BlockType =
  | 'title'
  | 'text'
  | 'image'
  | 'video'
  | 'button'
  | 'dynamic'
  | 'logo'
  | 'social'
  | 'html'
  | 'divider'
  | 'product'
  | 'navigation'
  | 'spacer'
  | 'split'
  | 'columns'
  | 'articles'
  | 'receipt'
  | 'notice'
  | 'footer'
  | 'section'
  | 'survey'

/** One cell of a multi-column block (`columns`, `product`, `articles`). */
export interface EmailBlockItem {
  id: string
  image: string
  title: string
  text: string
  /** Where the cell links to; also used as the cell's button href. */
  url?: string
  /** Alternative text for the cell image — required for accessibility/blocked-image fallback. */
  alt?: string
  /** Pre-formatted price string (`product` and `receipt` rows), e.g. "£29.00". */
  price?: string
  /** Optional strikethrough compare-at price shown next to `price`. */
  comparePrice?: string
  /** Quantity column of a `receipt` line item. Free text so "2 x" and "2" both work. */
  qty?: string
  /** Status pill on a `notice` row, e.g. "ALERT". */
  badge?: string
  /** Background colour of the `notice` status pill. */
  badgeColor?: string
}

/** A label/value line under a `receipt` table, such as VAT or the order total. */
export interface EmailSummaryRow {
  id: string
  label: string
  value: string
  /** Renders bold and larger — used for the final total. */
  emphasis?: boolean
}

/** A labelled link used by `navigation` and `footer` link rows. */
export interface EmailLink {
  id: string
  label: string
  url: string
}

/** A social profile. `icon` is an absolute image URL; without one the label renders as text. */
export interface EmailSocialLink {
  id: string
  label: string
  url: string
  icon?: string
}

export interface EmailBlockStyle {
  color?: string
  bgColor?: string
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  /** Uniform padding. Per-side values below win over this when set. */
  padding?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  btnBgColor?: string
  btnTextColor?: string
  btnRadius?: number
  btnVariant?: 'solid' | 'outline'
  dividerColor?: string
  height?: number
  fontFamily?: string
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  borderRadius?: number
  /** Colour for inline links inside the block (nav/footer link rows). */
  linkColor?: string
  /** Border drawn around the block's cell. */
  borderColor?: string
}

export interface EmailBlock {
  id: string
  type: BlockType
  content: string
  url?: string
  align?: 'left' | 'center' | 'right'
  subContent?: string
  subImage?: string
  items?: EmailBlockItem[]
  /** Link row for `navigation` / `footer`. */
  links?: EmailLink[]
  /** Social profiles for `social` / `footer` / `navigation`. */
  socials?: EmailSocialLink[]
  /** Totals rows beneath a `receipt` table. */
  summaryRows?: EmailSummaryRow[]
  /** Alternative text for `image` / `video` cover / `logo` image. */
  alt?: string
  /** Nested blocks for the 'section' type — a background/padding container for a group of blocks. */
  children?: EmailBlock[]
  width?: string
  style?: EmailBlockStyle
  /** `survey`: which survey the block links to. Each recipient gets a personal link at send time. */
  surveyId?: string
  /** `survey`: a button to the survey, or its first question answerable inside the email. */
  surveyMode?: 'button' | 'inline'
  /** `survey`: copy of the first question for inline mode, refreshed from the survey in the editor. */
  surveySnapshot?: SurveyEmailSnapshot
}

export interface GlobalStyle {
  bodyWidth: number
  bodyBgColor: string
  canvasBgColor: string
  buttonBgColor: string
  buttonTextColor: string
  buttonRadius: number
  fontFamily: string
  paddingX: number
  paddingY: number
  lineHeight: number
  /** Render each top-level block as its own rounded card on the canvas background. */
  cardMode?: boolean
  /** Corner radius of card-mode cards. */
  cardRadius?: number
  /** Vertical gap between card-mode cards, in px. */
  cardGap?: number
  /** Tiled background image behind the email body (VML-backed for Outlook). */
  bodyBgImage?: string
  /** Default colour for inline links. */
  linkColor?: string
  /** Text of the footer legal line appended after the blocks. Empty string hides it. */
  footerText?: string
}

export interface EmailBuilderProps {
  initialHtml: string
  onSave: (html: string) => void
  onClose: () => void
  campaignName: string
  campaignSubject?: string
  campaignSender?: { name: string; email: string }
  campaignPreviewText?: string
  campaignId?: number
  /** Set when editing a saved template rather than a campaign's body. */
  template?: { id: string; name: string }
}

/**
 * Runtime catalogue of the block types.
 *
 * This is the single source of truth for "which blocks exist". The builder's
 * palette and the copilot's generated tool reference both read it, so a new
 * block type cannot be added to `BlockType` and then be silently missing from
 * the palette or invisible to the AI — which is exactly what had happened to
 * `columns` (absent from the palette) and to `articles`, `receipt`, `notice`
 * and `footer` (absent from the copilot's prompt).
 */
export interface BlockTypeInfo {
  type: BlockType
  label: string
  /** Written for the copilot: what it is and when to reach for it. */
  description: string
  /** Fields beyond `id`/`type`/`style` that this block actually reads. */
  fields: string[]
}

const BLOCK_TYPE_INFO: Record<BlockType, Omit<BlockTypeInfo, 'type'>> = {
  title: {
    label: 'Title',
    description: 'A heading line.',
    fields: ['content', 'align'],
  },
  text: {
    label: 'Text',
    description: 'A paragraph of body copy. Supports {{ contact.first_name }} style tokens.',
    fields: ['content', 'align'],
  },
  image: {
    label: 'Image',
    description: 'A single image. Always set alt — most clients block images by default.',
    fields: ['content (image URL)', 'url (link target)', 'alt', 'width', 'align'],
  },
  video: {
    label: 'Video',
    description: 'A cover image with a play badge linking out; email cannot embed real video.',
    fields: ['content (cover image URL)', 'url', 'alt'],
  },
  button: {
    label: 'Button',
    description: 'A call-to-action button, rendered bulletproof for Outlook.',
    fields: ['content (label)', 'url', 'align'],
  },
  dynamic: {
    label: 'Dynamic content',
    description: 'A personalisation token block, e.g. a merge field.',
    fields: ['content'],
  },
  logo: {
    label: 'Logo',
    description: 'A brand logo image, usually first in the design.',
    fields: ['content (image URL)', 'url', 'alt', 'width', 'align'],
  },
  social: {
    label: 'Social links',
    description: 'A row of social profile icons or labels.',
    fields: ['socials'],
  },
  html: {
    label: 'Raw HTML',
    description: 'Escape hatch for hand-written markup. Avoid unless asked — native blocks are safer across clients.',
    fields: ['content (raw HTML)'],
  },
  divider: {
    label: 'Divider',
    description: 'A horizontal rule for visual separation.',
    fields: ['style.dividerColor'],
  },
  product: {
    label: 'Product grid',
    description: 'A multi-column grid of products with image, title, price and link.',
    fields: ['items[].{image,title,text,price,comparePrice,url,alt}'],
  },
  articles: {
    label: 'Article cards',
    description: 'A row of article/blog cards. The right choice for a newsletter digest.',
    fields: ['items[].{image,title,text,url,alt}'],
  },
  receipt: {
    label: 'Order receipt',
    description: 'A line-item table with quantities and a totals block. For transactional order emails.',
    fields: ['items[].{title,text,qty,price}', 'summaryRows[].{label,value,emphasis}'],
  },
  notice: {
    label: 'Notification list',
    description: 'Rows with a coloured status badge. For alerts and digests.',
    fields: ['items[].{title,text,badge,badgeColor,url}'],
  },
  navigation: {
    label: 'Navigation bar',
    description: 'A brand line with a row of nav links.',
    fields: ['content (brand)', 'url', 'links'],
  },
  footer: {
    label: 'Footer',
    description: 'Address, legal text, link row and socials. Include an {{ unsubscribe }} link here.',
    fields: ['content (address/legal)', 'links', 'socials'],
  },
  spacer: {
    label: 'Spacer',
    description: 'Vertical whitespace.',
    fields: ['style.height'],
  },
  split: {
    label: 'Split row',
    description: 'A two-up image-and-text row.',
    fields: ['content', 'subContent', 'subImage', 'url'],
  },
  columns: {
    label: 'Columns',
    description: 'A generic multi-column row of image/title/text cells.',
    fields: ['items[].{image,title,text,url,alt}'],
  },
  survey: {
    label: 'Survey',
    description:
      'Links to a published survey with a personal link per recipient, so answers land on their contact profile. surveyMode "inline" puts the first question (rating/NPS/scale/yes-no/choice) right in the email; "button" shows a call-to-action. Set surveyId; the snapshot is filled in automatically.',
    fields: ['surveyId', "surveyMode ('button' | 'inline')", 'content (button label)', 'subContent (intro text)', 'align'],
  },
  section: {
    label: 'Section / card',
    description: 'A background-and-padding container wrapping nested blocks.',
    fields: ['children (nested blocks)', 'style.bgColor', 'style.padding'],
  },
}

/** Declaration order is the order the builder palette shows them in. */
export const BLOCK_TYPES: BlockTypeInfo[] = (Object.keys(BLOCK_TYPE_INFO) as BlockType[])
  .map(type => ({ type, ...BLOCK_TYPE_INFO[type] }))

/**
 * Runtime catalogue of the page-level style keys, for the same reason as
 * `BLOCK_TYPES`: the copilot's `setGlobalStyle` takes a free-form object, so
 * without an enumerated list it can only guess. It reliably found
 * `bodyBgColor`/`buttonBgColor` and never `footerText`, `cardMode` or
 * `bodyBgImage`. Keyed by `GlobalStyle` so a new key cannot be added without
 * documenting it.
 */
const GLOBAL_STYLE_INFO: Record<keyof GlobalStyle, string> = {
  bodyWidth: 'Content width in px. 600 is the safe email default.',
  bodyBgColor: 'Background behind the content column.',
  canvasBgColor: 'Background outside the content column.',
  buttonBgColor: 'Default button fill.',
  buttonTextColor: 'Default button label colour.',
  buttonRadius: 'Default button corner radius in px.',
  fontFamily: 'Base font stack. Stick to web-safe stacks; custom fonts do not load in most clients.',
  paddingX: 'Horizontal padding inside the content column, in px.',
  paddingY: 'Vertical padding inside the content column, in px.',
  lineHeight: 'Base line height multiplier, e.g. 1.6.',
  cardMode: 'When true, each top-level block renders as its own rounded card on the canvas.',
  cardRadius: 'Corner radius of card-mode cards, in px.',
  cardGap: 'Vertical gap between card-mode cards, in px.',
  bodyBgImage: 'Tiled background image URL behind the body (VML-backed for Outlook).',
  linkColor: 'Default colour for inline links.',
  footerText: 'Legal/address line appended after the blocks. An empty string hides it — which also removes the automatic unsubscribe link.',
}

export const GLOBAL_STYLE_KEYS = (Object.keys(GLOBAL_STYLE_INFO) as Array<keyof GlobalStyle>)
  .map(key => ({ key, description: GLOBAL_STYLE_INFO[key] }))
