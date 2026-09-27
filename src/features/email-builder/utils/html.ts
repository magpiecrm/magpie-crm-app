/**
 * Low-level HTML primitives shared by the compiler.
 *
 * Everything here targets the lowest common denominator of email clients:
 * Outlook 2007-2019 renders with the Word engine, which ignores `float`,
 * `margin`, `max-width`, `position` and `border-radius`, so layout is done with
 * nested tables and conditional-comment fallbacks rather than CSS boxes.
 */
import type { BlockType, EmailBlock, EmailBlockStyle, GlobalStyle } from '../types'

export const escapeHtml = (value: string): string =>
  (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export const escapeAttr = (value: string): string => escapeHtml(value).replace(/'/g, '&#39;')

/**
 * Make a link target absolute.
 *
 * Authors type `www.example.com` into the URL fields, which is a *relative*
 * href once it reaches an inbox: clients either resolve it against their own
 * domain or refuse to linkify it at all, so the button silently does nothing.
 * Anything that already carries a scheme is left alone, as are in-page
 * anchors, `mailto:`/`tel:`, protocol-relative URLs, and unresolved
 * `{{ merge }}` tokens (the server substitutes those at send time).
 */
export const normalizeHref = (value: string | undefined): string => {
  const trimmed = (value || '').trim()
  if (!trimmed) return '#'
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    /^\{\{.*\}\}$/.test(trimmed) ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return trimmed
  }
  return `https://${trimmed}`
}

/** `normalizeHref` + attribute escaping. Use for every `href` the compiler emits. */
export const escapeHref = (value: string | undefined): string => escapeAttr(normalizeHref(value))

/**
 * Font stacks that resolve on every major client. A bare `sans-serif` is
 * unreliable in Outlook (it falls back to Times), so every stack ends in a
 * concrete Microsoft-installed face.
 */
export const EMAIL_FONT_STACKS = [
  { label: 'System Sans (Arial)', value: "Arial, 'Helvetica Neue', Helvetica, sans-serif" },
  { label: 'Helvetica', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Tahoma', value: 'Tahoma, Verdana, Segoe, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, Tahoma, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', Tahoma, Arial, sans-serif" },
  { label: 'Georgia (Serif)', value: "Georgia, 'Times New Roman', Times, serif" },
  { label: 'Times New Roman (Serif)', value: "'Times New Roman', Times, Georgia, serif" },
  { label: 'Courier (Mono)', value: "'Courier New', Courier, monospace" },
] as const

/**
 * Older saved templates stored bare generic families (`sans-serif`). Map those
 * onto a real stack so re-compiling an old campaign doesn't regress in Outlook.
 */
export const resolveFontFamily = (font?: string): string => {
  if (!font || !font.trim()) return EMAIL_FONT_STACKS[0].value
  const trimmed = font.trim()
  if (trimmed === 'sans-serif') return EMAIL_FONT_STACKS[0].value
  if (trimmed === 'serif') return EMAIL_FONT_STACKS[5].value
  if (trimmed === 'monospace') return EMAIL_FONT_STACKS[7].value
  // A stack that names only a webfont has no installed fallback — append one.
  if (!/(arial|helvetica|verdana|tahoma|georgia|times|courier|segoe|sans-serif|serif|monospace)/i.test(trimmed)) {
    return `${trimmed}, Arial, sans-serif`
  }
  return trimmed
}

/**
 * Per-type default padding (top, right, bottom, left). Shared by the compiler
 * and the canvas preview so what the editor shows matches what is sent.
 */
export const BLOCK_PADDING_DEFAULTS: Record<BlockType, [number, number, number, number]> = {
  title: [0, 0, 16, 0],
  text: [0, 0, 16, 0],
  logo: [16, 0, 16, 0],
  image: [0, 0, 20, 0],
  video: [0, 0, 20, 0],
  button: [20, 0, 20, 0],
  divider: [20, 0, 20, 0],
  spacer: [0, 0, 0, 0],
  social: [16, 0, 0, 0],
  html: [0, 0, 16, 0],
  dynamic: [0, 0, 16, 0],
  split: [0, 0, 24, 0],
  columns: [0, 0, 24, 0],
  articles: [0, 0, 24, 0],
  receipt: [0, 0, 24, 0],
  notice: [0, 0, 24, 0],
  product: [0, 0, 24, 0],
  navigation: [16, 0, 16, 0],
  footer: [24, 0, 0, 0],
  section: [20, 20, 20, 20],
  survey: [20, 0, 20, 0],
}

/**
 * Default padding per block type, as CSS shorthand order (top, right, bottom,
 * left). These carry the inter-block rhythm that used to come from margins —
 * the Word engine drops margins, so spacing has to live in the cell padding.
 */
export type PaddingFallback = number | [number, number] | [number, number, number, number]

export const resolvePadding = (
  style: EmailBlockStyle | undefined,
  fallback: PaddingFallback = 0,
): [number, number, number, number] => {
  const sides: [number, number, number, number] =
    typeof fallback === 'number'
      ? [fallback, fallback, fallback, fallback]
      : fallback.length === 2
        ? [fallback[0], fallback[1], fallback[0], fallback[1]]
        : fallback
  const base = style?.padding
  return [
    style?.paddingTop ?? base ?? sides[0],
    style?.paddingRight ?? base ?? sides[1],
    style?.paddingBottom ?? base ?? sides[2],
    style?.paddingLeft ?? base ?? sides[3],
  ]
}

/** Resolves the four padding sides, preferring per-side values over the uniform one. */
export const paddingCss = (style: EmailBlockStyle | undefined, fallback: PaddingFallback = 0): string => {
  const [top, right, bottom, left] = resolvePadding(style, fallback)
  return `padding: ${top}px ${right}px ${bottom}px ${left}px;`
}

/** Opens an Outlook/IE-only table so floated column tables line up in the Word engine. */
export const msoColsOpen = (firstWidth: string): string =>
  `<!--[if (gte mso 9)|(IE)]><table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation"><tr><td width="${firstWidth}" valign="top"><![endif]-->`

export const msoColsNext = (width: string): string =>
  `<!--[if (gte mso 9)|(IE)]></td><td width="${width}" valign="top"><![endif]-->`

export const msoColsClose = (): string => `<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->`

/**
 * A column that sits side-by-side on desktop and goes full width under 620px.
 * `float` + `display:inline-table` is the only combination Gmail, Apple Mail and
 * Yahoo all honour; Outlook gets the `msoCols*` table instead.
 */
export const column = (widthPercent: number, inner: string, extraClass = '', extraStyle = ''): string =>
  `<table cellpadding="0" cellspacing="0" border="0" role="presentation" class="xs-col mso-col-100 ${extraClass}" style="display: inline-table; vertical-align: top; float: left; width: ${widthPercent}%; ${extraStyle}"><tbody><tr><td>${inner}</td></tr></tbody></table>`

/**
 * A bulletproof button: VML rounded rectangle for the Word engine, a normal
 * anchor everywhere else. Outlook cannot render `border-radius` or padded
 * inline-blocks, so it needs the explicit pixel geometry the VML shape provides.
 */
export const bulletproofButton = (opts: {
  label: string
  href: string
  bgColor: string
  textColor: string
  radius: number
  font: string
  fontSize: number
  width?: number
  height: number
  outline?: boolean
}): string => {
  const { label, href, bgColor, textColor, radius, font, fontSize, width, height, outline } = opts
  const safeHref = escapeHref(href)
  const safeLabel = escapeHtml(label)
  const arcSize = Math.round((radius / Math.max(height, 1)) * 100)
  const vmlWidth = width ? `width: ${width}px;` : `width: ${Math.max(140, safeLabel.length * 9 + 48)}px;`
  const vmlFill = outline
    ? `fillcolor="#ffffff" strokecolor="${escapeAttr(bgColor)}" strokeweight="2px"`
    : `fillcolor="${escapeAttr(bgColor)}" stroke="f"`
  const vmlTextColor = outline ? bgColor : textColor
  const cssStyles = outline
    ? `background-color: transparent; border: 2px solid ${bgColor}; color: ${textColor || bgColor};`
    : `background-color: ${bgColor}; color: ${textColor};`

  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height: ${height}px; v-text-anchor: middle; ${vmlWidth}" arcsize="${arcSize}%" ${vmlFill}>
  <w:anchorlock/>
  <center style="color: ${escapeAttr(vmlTextColor)}; font-family: ${escapeAttr(font)}; font-size: ${fontSize}px; font-weight: bold;">${safeLabel}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!--><a href="${safeHref}" target="_blank" style="${cssStyles} border-radius: ${radius}px; font-family: ${font}; font-size: ${fontSize}px; font-weight: bold; line-height: ${height}px; text-align: center; text-decoration: none; display: inline-block; ${width ? `width: ${width}px;` : 'padding: 0 28px;'} height: ${height}px; mso-hide: all; -webkit-text-size-adjust: none;">${safeLabel}</a><!--<![endif]-->`
}

/** An `<img>` with the attributes every client needs to size and render it predictably. */
export const emailImage = (opts: {
  src: string
  alt: string
  width?: number | string
  height?: number
  radius?: number
  block?: boolean
}): string => {
  const { src, alt, width, height, radius, block = true } = opts
  const widthAttr = typeof width === 'number' ? ` width="${width}"` : ''
  const widthCss = width === undefined ? 'width: 100%;' : typeof width === 'number' ? `width: ${width}px;` : `width: ${width};`
  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${widthAttr}${height ? ` height="${height}"` : ''} style="${widthCss} max-width: 100%; ${height ? `height: ${height}px;` : 'height: auto;'} ${radius ? `border-radius: ${radius}px;` : ''} border: 0; outline: none; text-decoration: none; ${block ? 'display: block;' : 'display: inline-block; vertical-align: middle;'} -ms-interpolation-mode: bicubic;" />`
}

/** A vertical gap that survives Outlook, which collapses empty cells. */
export const spacerRow = (height: number): string =>
  `<tr><td height="${height}" style="height: ${height}px; font-size: 0; line-height: 0; mso-line-height-rule: exactly;">&nbsp;</td></tr>`

/** Wraps a block's markup in the full-width presentation table every block emits. */
export const blockTable = (cellStyle: string, inner: string, extraClass = ''): string =>
  `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" class="${extraClass}" style="width: 100%; border-collapse: collapse;"><tbody><tr><td style="${cellStyle}">${inner}</td></tr></tbody></table>`

export const resolveLinkColor = (block: EmailBlock, globalStyle: GlobalStyle): string =>
  block.style?.linkColor ?? globalStyle.linkColor ?? '#2563eb'
