/**
 * Compiles the block model to email-client-safe HTML.
 *
 * Layout is table-based throughout: Outlook 2007-2019 uses the Word rendering
 * engine, which drops `float`, `margin`, `max-width`, `position` and
 * `border-radius`. Multi-column blocks emit both the CSS float version (Gmail,
 * Apple Mail, Yahoo) and a conditional-comment table fallback (Outlook/IE), and
 * collapse to a single column below 620px via the `.xs-col` class in the head.
 */
import type { EmailBlock, EmailLink, EmailSocialLink, EmailSummaryRow, GlobalStyle } from '../types'
import {
  BLOCK_PADDING_DEFAULTS,
  blockTable,
  bulletproofButton,
  column,
  emailImage,
  escapeAttr,
  escapeHref,
  escapeHtml,
  msoColsClose,
  msoColsNext,
  msoColsOpen,
  paddingCss,
  resolveFontFamily,
  resolveLinkColor,
  spacerRow,
} from './html'
import { renderSurveyInlineHtml, surveyLinkPlaceholder } from '../../survey-builder/utils/emailSnippet'

type BlockRenderer = (block: EmailBlock, globalStyle: GlobalStyle) => string

const font = (block: EmailBlock, globalStyle: GlobalStyle): string =>
  resolveFontFamily(block.style?.fontFamily ?? globalStyle.fontFamily)

/**
 * A block narrowed below full width is emitted as an aligned nested table
 * rather than a floated div, which is the only form Outlook honours.
 */
const withWidth = (block: EmailBlock, inner: string): string => {
  const isCustomWidth = block.width && block.width !== '100%'
  if (!isCustomWidth) return inner
  const align = block.align || 'left'
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" align="${align}" class="xs-col" style="width: ${block.width}; ${align === 'center' ? 'margin: 0 auto;' : ''} border-collapse: collapse;"><tbody><tr><td>${inner}</td></tr></tbody></table>`
}

const renderLogo: BlockRenderer = (block, globalStyle) => {
  const align = block.align || 'center'
  const isImage = /^(https?:)?\/\//.test(block.content || '')
  const inner = isImage
    ? `<a href="${escapeHref(block.url || '#')}" target="_blank" style="text-decoration: none;">${emailImage({ src: block.content, alt: block.alt || 'Logo', width: block.style?.height ? undefined : 140, height: block.style?.height, block: false })}</a>`
    : `<span style="font-family: ${font(block, globalStyle)}; font-size: ${block.style?.fontSize ?? 20}px; font-weight: bold; letter-spacing: -0.5px; color: ${block.style?.color ?? '#111827'};">${escapeHtml(block.content || 'LOGO')}</span>`
  const cellStyle = `${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])} text-align: ${align}; ${block.style?.bgColor ? `background-color: ${block.style.bgColor};` : ''}`
  return blockTable(cellStyle, inner)
}

const renderTitle: BlockRenderer = (block, globalStyle) => {
  const textAlign = block.style?.textAlign ?? block.align ?? 'left'
  const cellStyle = [
    `font-family: ${font(block, globalStyle)}`,
    `font-size: ${block.style?.fontSize ?? 24}px`,
    `font-weight: ${block.style?.fontWeight ?? 'bold'}`,
    `color: ${block.style?.color ?? '#111827'}`,
    'line-height: 1.3',
    'mso-line-height-rule: exactly',
    `text-align: ${textAlign}`,
    block.style?.bgColor ? `background-color: ${block.style.bgColor}` : '',
  ].filter(Boolean).join('; ')
  return withWidth(block, blockTable(`${cellStyle}; ${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])}`, escapeHtml(block.content)))
}

const renderText: BlockRenderer = (block, globalStyle) => {
  const textAlign = block.style?.textAlign ?? block.align ?? 'left'
  const cellStyle = [
    `font-family: ${font(block, globalStyle)}`,
    `font-size: ${block.style?.fontSize ?? 15}px`,
    `font-weight: ${block.style?.fontWeight ?? 'normal'}`,
    `color: ${block.style?.color ?? '#4b5563'}`,
    `line-height: ${globalStyle.lineHeight}`,
    'mso-line-height-rule: exactly',
    `text-align: ${textAlign}`,
    block.style?.bgColor ? `background-color: ${block.style.bgColor}` : '',
  ].filter(Boolean).join('; ')
  // Newlines are authored in a plain textarea, so they carry meaning.
  const body = escapeHtml(block.content).replace(/\n/g, '<br />')
  return withWidth(block, blockTable(`${cellStyle}; ${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])}`, body))
}

const renderImage: BlockRenderer = (block) => {
  const align = block.align || 'center'
  const img = emailImage({
    src: block.content || 'https://via.placeholder.com/600x300',
    alt: block.alt || '',
    height: block.style?.height,
    radius: block.style?.borderRadius ?? 6,
  })
  const linked = block.url ? `<a href="${escapeHref(block.url)}" target="_blank" style="text-decoration: none;">${img}</a>` : img
  return withWidth(block, blockTable(`${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])} text-align: ${align};`, linked))
}

/**
 * Outlook cannot overlay the play badge (no `position`), so the cover image
 * links out and the badge is a real row beneath it — visible in every client.
 */
const renderVideo: BlockRenderer = (block, globalStyle) => {
  const href = escapeHref(block.url)
  const cover = emailImage({
    src: block.content || 'https://via.placeholder.com/600x338',
    alt: block.alt || 'Video cover',
    height: block.style?.height,
    radius: block.style?.borderRadius ?? 6,
  })
  const inner = `<a href="${href}" target="_blank" style="text-decoration: none;">${cover}</a>
    <div style="font-family: ${font(block, globalStyle)}; font-size: 14px; font-weight: bold; padding-top: 10px;"><a href="${href}" target="_blank" style="color: ${resolveLinkColor(block, globalStyle)}; text-decoration: none;">&#9654;&nbsp; Watch the video</a></div>`
  return withWidth(block, blockTable(`${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])} text-align: ${block.align || 'center'};`, inner))
}

const renderButton: BlockRenderer = (block, globalStyle) => {
  const isCustomWidth = Boolean(block.width && block.width !== '100%')
  const btn = bulletproofButton({
    label: block.content || 'Click here',
    href: block.url || '#',
    bgColor: block.style?.btnBgColor ?? globalStyle.buttonBgColor,
    textColor: block.style?.btnTextColor ?? globalStyle.buttonTextColor,
    radius: block.style?.btnRadius ?? globalStyle.buttonRadius,
    font: font(block, globalStyle),
    fontSize: block.style?.fontSize ?? 14,
    height: block.style?.height ?? 44,
    width: isCustomWidth ? Math.round((parseFloat(block.width!) / 100) * globalStyle.bodyWidth) : undefined,
    outline: block.style?.btnVariant === 'outline',
  })
  return blockTable(`${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])} text-align: ${block.align || 'left'};`, btn)
}

/** `<hr>` is unreliable in Outlook — a zero-height bordered cell is not. */
const renderDivider: BlockRenderer = (block) => {
  const color = block.style?.dividerColor ?? '#e5e7eb'
  return blockTable(
    `${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])}`,
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width: 100%; border-collapse: collapse;"><tbody><tr><td style="border-top: 1px solid ${color}; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr></tbody></table>`,
  )
}

const renderSpacer: BlockRenderer = (block) => {
  const height = parseInt(block.content || '30') || 30
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width: 100%; border-collapse: collapse;"><tbody>${spacerRow(height)}</tbody></table>`
}

const DEFAULT_SOCIALS: EmailSocialLink[] = [
  { id: 's1', label: 'Twitter', url: '#' },
  { id: 's2', label: 'LinkedIn', url: '#' },
]

/**
 * Social row. Icons are real `<img>` cells when the block supplies icon URLs;
 * without them it degrades to styled text links rather than depending on a
 * third-party icon CDN.
 */
const socialCells = (block: EmailBlock, globalStyle: GlobalStyle, color: string): string => {
  const socials = block.socials?.length ? block.socials : DEFAULT_SOCIALS
  return socials
    .map(
      (s) =>
        `<td style="padding: 0 8px;"><a href="${escapeHref(s.url || '#')}" target="_blank" style="color: ${color}; text-decoration: none; font-family: ${font(block, globalStyle)}; font-size: 13px;">${
          s.icon ? emailImage({ src: s.icon, alt: s.label, width: 20, block: false }) : escapeHtml(s.label)
        }</a></td>`,
    )
    .join('')
}

const renderSocial: BlockRenderer = (block, globalStyle) => {
  const color = block.style?.color ?? '#4b5563'
  const inner = `<table cellpadding="0" cellspacing="0" border="0" role="presentation" align="${block.align || 'center'}" style="${block.align === 'center' || !block.align ? 'margin: 0 auto;' : ''} border-collapse: collapse;"><tbody><tr>${socialCells(block, globalStyle, color)}</tr></tbody></table>`
  return blockTable(`${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])} text-align: ${block.align || 'center'};`, inner)
}

// Raw HTML block: content is intentionally emitted unescaped.
const renderHtml: BlockRenderer = (block) => blockTable(paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type]), block.content)

const renderDynamic: BlockRenderer = (block, globalStyle) =>
  blockTable(
    paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type]),
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width: 100%; border-collapse: collapse;"><tbody><tr><td style="padding: 12px; background-color: #f9fafb; border: 1px dashed #d1d5db; font-family: ${font(block, globalStyle)}; font-size: 13px; color: #374151;">{{ ${escapeHtml(block.content || 'dynamic_var')} }}</td></tr></tbody></table>`,
  )

/** Two-column media/text row that stacks below 620px. */
const renderSplit: BlockRenderer = (block, globalStyle) => {
  const f = font(block, globalStyle)
  const bodyWidth = globalStyle.bodyWidth - globalStyle.paddingX * 2
  const mediaFirst = block.align !== 'right'
  const media = column(
    48,
    emailImage({ src: block.subImage || 'https://via.placeholder.com/300x200', alt: block.alt || '', radius: block.style?.borderRadius ?? 6 }),
    'xs-mb-16',
    `padding-${mediaFirst ? 'right' : 'left'}: 12px;`,
  )
  const copy = column(
    52,
    `<div style="font-family: ${f}; font-size: 18px; font-weight: bold; color: ${block.style?.color ?? '#111827'}; padding-bottom: 8px;">${escapeHtml(block.content)}</div>
     <div style="font-family: ${f}; font-size: 14px; line-height: ${globalStyle.lineHeight}; color: #4b5563; padding-bottom: 14px;">${escapeHtml(block.subContent || '')}</div>
     ${bulletproofButton({
       label: 'Read more',
       href: block.url || '#',
       bgColor: block.style?.btnBgColor ?? globalStyle.buttonBgColor,
       textColor: block.style?.btnTextColor ?? globalStyle.buttonTextColor,
       radius: block.style?.btnRadius ?? globalStyle.buttonRadius,
       font: f,
       fontSize: 14,
       height: 40,
     })}`,
    '',
    `padding-${mediaFirst ? 'left' : 'right'}: 12px;`,
  )
  const first = mediaFirst ? media : copy
  const second = mediaFirst ? copy : media
  const firstWidth = Math.round(bodyWidth * (mediaFirst ? 0.48 : 0.52))
  const secondWidth = bodyWidth - firstWidth
  return blockTable(
    paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type]),
    `${msoColsOpen(String(firstWidth))}${first}${msoColsNext(String(secondWidth))}${second}${msoColsClose()}`,
  )
}

/** Shared engine for the evenly-split card grids (`columns`, `articles`, `product`). */
const renderGrid = (
  block: EmailBlock,
  globalStyle: GlobalStyle,
  perRow: number,
  cell: (item: NonNullable<EmailBlock['items']>[number], f: string) => string,
): string => {
  const items = block.items || []
  if (items.length === 0) return ''
  const f = font(block, globalStyle)
  const widthPercent = 100 / perRow
  const bodyWidth = globalStyle.bodyWidth - globalStyle.paddingX * 2
  const msoWidth = String(Math.floor(bodyWidth / perRow))

  const rows: string[] = []
  for (let i = 0; i < items.length; i += perRow) {
    const slice = items.slice(i, i + perRow)
    const cols = slice
      .map((item, index) => column(widthPercent, cell(item, f), 'xs-mb-20', `padding: 0 ${index === 0 ? '8px 0 0' : index === slice.length - 1 ? '0 0 0 8px' : '8px'};`))
      .join(msoColsNext(msoWidth))
    rows.push(`<tr><td style="${i === 0 ? '' : 'padding-top: 24px;'}">${msoColsOpen(msoWidth)}${cols}${msoColsClose()}</td></tr>`)
  }

  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width: 100%; border-collapse: collapse;"><tbody><tr><td style="${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])}"><table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width: 100%; border-collapse: collapse;"><tbody>${rows.join('')}</tbody></table></td></tr></tbody></table>`
}

const renderColumns: BlockRenderer = (block, globalStyle) =>
  renderGrid(block, globalStyle, 3, (item, f) =>
    `${emailImage({ src: item.image, alt: item.alt || '', radius: block.style?.borderRadius ?? 6 })}
     <div style="font-family: ${f}; font-size: 15px; font-weight: bold; color: #111827; padding: 10px 0 4px 0; text-align: center;">${escapeHtml(item.title)}</div>
     <div style="font-family: ${f}; font-size: 13px; line-height: 1.5; color: #6b7280; text-align: center;">${escapeHtml(item.text)}</div>`)

/** Two-up article/post cards, the standard newsletter "latest posts" row. */
const renderArticles: BlockRenderer = (block, globalStyle) =>
  renderGrid(block, globalStyle, 2, (item, f) =>
    `<a href="${escapeHref(item.url || '#')}" target="_blank" style="text-decoration: none;">${emailImage({ src: item.image, alt: item.alt || '', radius: block.style?.borderRadius ?? 6 })}</a>
     <div style="font-family: ${f}; font-size: 17px; font-weight: bold; line-height: 1.35; padding: 12px 0 6px 0;"><a href="${escapeHref(item.url || '#')}" target="_blank" style="color: ${block.style?.color ?? '#111827'}; text-decoration: none;">${escapeHtml(item.title)}</a></div>
     <div style="font-family: ${f}; font-size: 14px; line-height: ${globalStyle.lineHeight}; color: #6b7280; padding-bottom: 10px;">${escapeHtml(item.text)}</div>
     <div style="font-family: ${f}; font-size: 13px; font-weight: bold;"><a href="${escapeHref(item.url || '#')}" target="_blank" style="color: ${resolveLinkColor(block, globalStyle)}; text-decoration: none;">Read more &rarr;</a></div>`)

/** Product grid with price, compare-at price and a per-item buy button. */
const renderProduct: BlockRenderer = (block, globalStyle) =>
  renderGrid(block, globalStyle, 2, (item, f) =>
    `<a href="${escapeHref(item.url || '#')}" target="_blank" style="text-decoration: none;">${emailImage({ src: item.image, alt: item.alt || item.title, radius: block.style?.borderRadius ?? 6 })}</a>
     <div style="font-family: ${f}; font-size: 15px; font-weight: bold; color: #111827; padding: 12px 0 4px 0; text-align: center;">${escapeHtml(item.title)}</div>
     ${item.text ? `<div style="font-family: ${f}; font-size: 13px; color: #6b7280; text-align: center; padding-bottom: 6px;">${escapeHtml(item.text)}</div>` : ''}
     <div style="font-family: ${f}; font-size: 15px; font-weight: bold; color: ${block.style?.color ?? '#111827'}; text-align: center; padding-bottom: 12px;">${escapeHtml(item.price || '')}${item.comparePrice ? ` <span style="color: #9ca3af; font-weight: normal; text-decoration: line-through;">${escapeHtml(item.comparePrice)}</span>` : ''}</div>
     <div style="text-align: center;">${bulletproofButton({
       label: block.content || 'Buy now',
       href: item.url || '#',
       bgColor: block.style?.btnBgColor ?? globalStyle.buttonBgColor,
       textColor: block.style?.btnTextColor ?? globalStyle.buttonTextColor,
       radius: block.style?.btnRadius ?? globalStyle.buttonRadius,
       font: f,
       fontSize: 13,
       height: 38,
     })}</div>`)

const DEFAULT_SUMMARY_ROWS: EmailSummaryRow[] = [{ id: 'sr1', label: 'Total', value: '', emphasis: true }]

/**
 * Order summary table: line items over label/value totals. This is real tabular
 * data, so it stays a genuine `<table>` (no `role="presentation"`) and the
 * column widths are set with `width` attributes, which the Word engine honours
 * where percentage CSS would be ignored.
 */
const renderReceipt: BlockRenderer = (block, globalStyle) => {
  const f = font(block, globalStyle)
  const color = block.style?.color ?? '#111827'
  const borderColor = block.style?.borderColor ?? '#d5d5d5'
  const cell = `font-family: ${f}; font-size: 15px; line-height: 22px; color: ${color}; word-break: normal;`

  const header = block.content
    ? `<tr><th colspan="3" align="center" style="${cell} font-size: 18px; font-weight: bold; text-align: center; padding: 10px 0; border-bottom: 2px solid ${borderColor};">${escapeHtml(block.content)}</th></tr>`
    : ''

  const lines = (block.items || [])
    .map(
      (item) => `<tr>
        <td width="60%" style="${cell} width: 60%; padding: 10px 0 0 0;">${escapeHtml(item.title)}${item.text ? `<br /><span style="font-size: 13px; color: #6b7280;">${escapeHtml(item.text)}</span>` : ''}</td>
        <td width="20%" align="right" style="${cell} width: 20%; text-align: right; padding: 10px 0 0 0;">${escapeHtml(item.qty || '')}</td>
        <td width="20%" align="right" style="${cell} width: 20%; text-align: right; padding: 10px 0 0 0;">${escapeHtml(item.price || '')}</td>
      </tr>`,
    )
    .join('')

  const rule = `<tr><td colspan="3" style="border-bottom: 1px solid ${borderColor}; font-size: 0; line-height: 0; height: 1px; padding-top: 10px;">&nbsp;</td></tr>`

  const summary = (block.summaryRows?.length ? block.summaryRows : DEFAULT_SUMMARY_ROWS)
    .map(
      (row) => `<tr>
        <td colspan="2" align="left" style="${cell} ${row.emphasis ? 'font-size: 17px; font-weight: bold;' : ''} padding: 10px 0 0 0; text-align: left;">${escapeHtml(row.label)}</td>
        <td align="right" style="${cell} ${row.emphasis ? 'font-size: 17px; font-weight: bold;' : ''} padding: 10px 0 0 0; text-align: right;">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join('')

  return blockTable(
    paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type]),
    `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width: 100%; border-collapse: collapse; table-layout: auto;"><tbody>${header}${lines}${rule}${summary}</tbody></table>`,
  )
}

const DEFAULT_NOTICE_COLOR = '#6b7280'

/** Status-badged rows: a coloured pill, a headline, body copy and a details link. */
const renderNotice: BlockRenderer = (block, globalStyle) => {
  const f = font(block, globalStyle)
  const borderColor = block.style?.borderColor ?? '#e5e7eb'
  const items = block.items || []

  const rows = items
    .map((item, index) => {
      const badgeColor = item.badgeColor || DEFAULT_NOTICE_COLOR
      const badge = item.badge
        ? `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse: collapse;"><tbody><tr><td style="background-color: ${badgeColor}; ${block.style?.borderRadius != null ? `border-radius: ${block.style.borderRadius}px;` : 'border-radius: 3px;'} padding: 3px 9px; font-family: ${f}; font-size: 11px; font-weight: bold; letter-spacing: 0.6px; color: #ffffff;">${escapeHtml(item.badge.toUpperCase())}</td></tr></tbody></table>`
        : ''
      const link = item.url
        ? `<div style="font-family: ${f}; font-size: 13px; font-weight: bold; padding-top: 10px;"><a href="${escapeHref(item.url)}" target="_blank" style="color: ${resolveLinkColor(block, globalStyle)}; text-decoration: none;">${escapeHtml(block.content || 'Details')} &rarr;</a></div>`
        : ''
      return `<tr><td style="padding: ${index === 0 ? '0' : '18px'} 0 18px 0; ${index < items.length - 1 ? `border-bottom: 1px solid ${borderColor};` : ''}">
        ${badge}
        <div style="font-family: ${f}; font-size: 17px; font-weight: bold; color: ${block.style?.color ?? '#111827'}; padding: ${item.badge ? '10px' : '0'} 0 6px 0;">${escapeHtml(item.title)}</div>
        <div style="font-family: ${f}; font-size: 14px; line-height: ${globalStyle.lineHeight}; color: #6b7280;">${escapeHtml(item.text)}</div>
        ${link}
      </td></tr>`
    })
    .join('')

  return blockTable(
    paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type]),
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width: 100%; border-collapse: collapse;"><tbody>${rows}</tbody></table>`,
  )
}

const DEFAULT_NAV_LINKS: EmailLink[] = [
  { id: 'n1', label: 'Shop', url: '#' },
  { id: 'n2', label: 'About', url: '#' },
  { id: 'n3', label: 'Contact', url: '#' },
]

/** Logo on the left, link row on the right; both go full width and centre on mobile. */
const renderNavigation: BlockRenderer = (block, globalStyle) => {
  const f = font(block, globalStyle)
  const linkColor = block.style?.linkColor ?? block.style?.color ?? '#111827'
  const links = block.links?.length ? block.links : DEFAULT_NAV_LINKS
  const isImageLogo = /^(https?:)?\/\//.test(block.content || '')
  const brand = isImageLogo
    ? `<a href="${escapeHref(block.url || '#')}" target="_blank">${emailImage({ src: block.content, alt: block.alt || 'Logo', width: 130, block: false })}</a>`
    : `<span style="font-family: ${f}; font-size: ${block.style?.fontSize ?? 18}px; font-weight: bold; letter-spacing: -0.4px; color: ${block.style?.color ?? '#111827'};">${escapeHtml(block.content || 'MY BRAND')}</span>`

  const linkCells = links
    .map((l) => `<td style="padding: 0 10px;"><a href="${escapeHref(l.url || '#')}" target="_blank" style="font-family: ${f}; font-size: 14px; color: ${linkColor}; text-decoration: none;">${escapeHtml(l.label)}</a></td>`)
    .join('')

  const bodyWidth = globalStyle.bodyWidth - globalStyle.paddingX * 2
  const left = column(45, brand, 'xs-center xs-mb-16')
  const right = column(
    55,
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" align="right" class="xs-table-center" style="border-collapse: collapse;"><tbody><tr>${linkCells}</tr></tbody></table>`,
    'xs-center',
  )
  const cellStyle = `${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])} ${block.style?.bgColor ? `background-color: ${block.style.bgColor};` : ''}`
  return blockTable(
    cellStyle,
    `${msoColsOpen(String(Math.round(bodyWidth * 0.45)))}${left}${msoColsNext(String(Math.round(bodyWidth * 0.55)))}${right}${msoColsClose()}`,
  )
}

const DEFAULT_FOOTER_LINKS: EmailLink[] = [
  { id: 'f1', label: 'Unsubscribe', url: '{{ unsubscribe }}' },
  { id: 'f2', label: 'Privacy', url: '#' },
  { id: 'f3', label: 'Contact', url: '#' },
]

/** Address line, link row and social row — the standard compliance footer. */
const renderFooter: BlockRenderer = (block, globalStyle) => {
  const f = font(block, globalStyle)
  const color = block.style?.color ?? '#6b7280'
  const links = block.links?.length ? block.links : DEFAULT_FOOTER_LINKS
  const linkCells = links
    .map((l) => `<td style="padding: 0 8px;"><a href="${escapeHref(l.url || '#')}" target="_blank" style="font-family: ${f}; font-size: 13px; color: ${block.style?.linkColor ?? color}; text-decoration: underline;">${escapeHtml(l.label)}</a></td>`)
    .join('')

  const socialRow = block.socials?.length
    ? `<tr><td align="center" style="padding-bottom: 14px;"><table cellpadding="0" cellspacing="0" border="0" role="presentation" align="center" style="margin: 0 auto; border-collapse: collapse;"><tbody><tr>${socialCells(block, globalStyle, color)}</tr></tbody></table></td></tr>`
    : ''

  const inner = `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width: 100%; border-collapse: collapse;"><tbody>
    ${socialRow}
    <tr><td align="center" style="padding-bottom: 12px;"><table cellpadding="0" cellspacing="0" border="0" role="presentation" align="center" style="margin: 0 auto; border-collapse: collapse;"><tbody><tr>${linkCells}</tr></tbody></table></td></tr>
    <tr><td align="center" style="font-family: ${f}; font-size: 12px; line-height: 1.6; color: ${color};">${escapeHtml(block.content || '').replace(/\n/g, '<br />')}</td></tr>
  </tbody></table>`

  const cellStyle = `${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])} ${block.style?.bgColor ? `background-color: ${block.style.bgColor};` : ''} ${block.style?.borderColor ? `border-top: 1px solid ${block.style.borderColor};` : ''}`
  return blockTable(cellStyle, inner)
}

const renderSection: BlockRenderer = (block, globalStyle) => {
  const bg = block.style?.bgColor ?? 'transparent'
  const radius = block.style?.borderRadius ?? 0
  const childrenHtml = (block.children || [])
    .map((child) => blockRenderers[child.type]?.(child, globalStyle) ?? '')
    .join('\n')
  const cellStyle = `background-color: ${bg}; ${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])} ${radius ? `border-radius: ${radius}px;` : ''} ${block.style?.borderColor ? `border: 1px solid ${block.style.borderColor};` : ''}`
  return blockTable(cellStyle, `<table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%" style="width: 100%; border-collapse: collapse;"><tbody><tr><td>${childrenHtml}</td></tr></tbody></table>`)
}

/**
 * Survey links are `{{ survey_link:… }}` / `{{ survey_answer:… }}` placeholders,
 * swapped for per-recipient URLs at send time (`server/surveyLinks.ts`).
 */
const renderSurvey: BlockRenderer = (block, globalStyle) => {
  if (!block.surveyId) return ''
  const fontStack = font(block, globalStyle)
  const accent = block.style?.btnBgColor ?? globalStyle.buttonBgColor
  const accentText = block.style?.btnTextColor ?? globalStyle.buttonTextColor
  const textColor = block.style?.color ?? '#18181b'
  const intro = block.subContent
    ? `<div style="font-family: ${fontStack}; font-size: 15px; color: ${escapeAttr(textColor)}; padding-bottom: 12px;">${escapeHtml(block.subContent)}</div>`
    : ''
  const button = bulletproofButton({
    label: block.content || 'Take the survey',
    href: surveyLinkPlaceholder(block.surveyId),
    bgColor: accent,
    textColor: accentText,
    radius: block.style?.btnRadius ?? globalStyle.buttonRadius,
    font: fontStack,
    fontSize: 15,
    height: 44,
  })

  const body =
    block.surveyMode === 'inline' && block.surveySnapshot
      ? `${renderSurveyInlineHtml(block.surveyId, block.surveySnapshot, {
          accent,
          accentText,
          textColor,
          font: fontStack,
          radius: Math.min(block.style?.btnRadius ?? globalStyle.buttonRadius, 8),
        })}<div style="font-family: ${fontStack}; font-size: 13px; padding-top: 12px;"><a href="${escapeAttr(surveyLinkPlaceholder(block.surveyId))}" target="_blank" style="color: ${resolveLinkColor(block, globalStyle)};">Open the full survey</a></div>`
      : button
  return blockTable(`${paddingCss(block.style, BLOCK_PADDING_DEFAULTS[block.type])} text-align: ${block.align || 'center'};`, `${intro}${body}`)
}

const blockRenderers: Partial<Record<EmailBlock['type'], BlockRenderer>> = {
  logo: renderLogo,
  title: renderTitle,
  text: renderText,
  image: renderImage,
  video: renderVideo,
  button: renderButton,
  divider: renderDivider,
  spacer: renderSpacer,
  social: renderSocial,
  html: renderHtml,
  dynamic: renderDynamic,
  split: renderSplit,
  columns: renderColumns,
  articles: renderArticles,
  receipt: renderReceipt,
  notice: renderNotice,
  product: renderProduct,
  navigation: renderNavigation,
  footer: renderFooter,
  section: renderSection,
  survey: renderSurvey,
}

/**
 * Client resets and the single mobile breakpoint. Kept in a `<style>` block
 * because the classes it defines only need to reach clients that support
 * `<head>` CSS — the desktop layout works without any of it.
 */
const headStyles = (globalStyle: GlobalStyle): string => `
    body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    table, tr, td { border-collapse: collapse; }
    img { border: 0; outline: none; line-height: 100%; text-decoration: none; -ms-interpolation-mode: bicubic; }
    body, td, th, p, div, li, a, span { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-line-height-rule: exactly; }
    a { color: ${globalStyle.linkColor ?? '#2563eb'}; }
    /* Stops iOS auto-linking dates and addresses in its own blue. */
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
    .em-container { width: ${globalStyle.bodyWidth}px; margin: 0 auto; }
    @media screen and (max-width: 620px) {
      .em-container { width: 100% !important; }
      .xs-col { width: 100% !important; display: block !important; float: none !important; padding-left: 0 !important; padding-right: 0 !important; }
      .xs-center { text-align: center !important; }
      .xs-table-center { float: none !important; margin: 0 auto !important; }
      .xs-mb-16 { padding-bottom: 16px !important; }
      .xs-mb-20 { padding-bottom: 20px !important; }
      .xs-hide { display: none !important; }
    }`

const DEFAULT_FOOTER_TEXT =
  'This email was sent to you because you are subscribed to our newsletter.'

export const compileHTML = (currentBlocks: EmailBlock[], globalStyle: GlobalStyle): string => {
  const bodyFont = resolveFontFamily(globalStyle.fontFamily)
  const cardMode = globalStyle.cardMode === true
  const cardGap = globalStyle.cardGap ?? 10
  const cardRadius = globalStyle.cardRadius ?? 5

  const rendered = currentBlocks
    .map((block) => blockRenderers[block.type]?.(block, globalStyle) ?? '')
    .filter(Boolean)

  /**
   * Card mode gives each block its own panel on the canvas background — the
   * body padding moves onto the individual cards so the gaps between them show
   * the canvas through.
   */
  const content = cardMode
    ? rendered
        .map(
          (html, index) =>
            `<tr><td style="background-color: ${globalStyle.bodyBgColor}; ${cardRadius ? `border-radius: ${cardRadius}px;` : ''} padding: ${globalStyle.paddingY}px ${globalStyle.paddingX}px;">${html}</td></tr>${index < rendered.length - 1 ? spacerRow(cardGap) : ''}`,
        )
        .join('\n')
    : `<tr><td style="background-color: ${globalStyle.bodyBgColor}; padding: ${globalStyle.paddingY}px ${globalStyle.paddingX}px;">${rendered.join('\n')}</td></tr>`

  const footerText = globalStyle.footerText ?? DEFAULT_FOOTER_TEXT
  const legalFooter = footerText
    ? `<tr><td align="center" style="font-family: ${bodyFont}; font-size: 12px; line-height: 1.6; color: #9ca3af; padding: 24px 20px 0 20px;">${escapeHtml(footerText).replace(/\n/g, '<br />')}<br /><a href="{{ unsubscribe }}" style="color: ${globalStyle.linkColor ?? '#2563eb'}; text-decoration: underline;">Unsubscribe from this list</a></td></tr>`
    : ''

  const bgImage = globalStyle.bodyBgImage
  const vmlBackground = bgImage
    ? `<!--[if gte mso 9]><v:background xmlns:v="urn:schemas-microsoft-com:vml" fill="t"><v:fill type="tile" src="${escapeAttr(bgImage)}" color="${escapeAttr(globalStyle.canvasBgColor)}"></v:fill></v:background><![endif]-->`
    : ''
  const bodyBgCss = bgImage
    ? `background-color: ${globalStyle.canvasBgColor}; background-image: url('${escapeAttr(bgImage)}'); background-position: center; background-repeat: repeat; background-size: cover;`
    : `background-color: ${globalStyle.canvasBgColor};`

  const metadata = { blocks: currentBlocks, globalStyle }
  /**
   * The block model round-trips through an HTML comment, so any `--` in the
   * authored content would close it early and corrupt the document. `\u002d`/`\u003c` are
   * valid JSON escapes, so the payload still parses on the way back in.
   */
  const metadataJson = JSON.stringify(metadata)
    .replace(/-{2,}/g, (match) => '\\u002d'.repeat(match.length))
    .replace(/</g, '\\u003c')

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <!--[if !mso]><!-->
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--<![endif]-->
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="format-detection" content="telephone=no" />
  <meta name="x-apple-disable-message-reformatting" />
  <title></title>
  <style type="text/css">${headStyles(globalStyle)}
  </style>
  <!--[if gte mso 9]>
  <style type="text/css">
    .mso-col-100 { width: 100% !important; }
  </style>
  <![endif]-->
</head>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<body style="margin: 0; padding: 0; width: 100% !important; mso-line-height-rule: exactly; ${bodyBgCss} font-family: ${bodyFont};">
  <!-- BLOCKS_DATA: ${metadataJson} -->
  <table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; table-layout: fixed; border-collapse: collapse; ${bodyBgCss}">
    <tbody>
      <tr>
        <td align="center" valign="top" style="padding: 24px 0;">
          ${vmlBackground}
          <!--[if (gte mso 9)|(IE)]><table width="${globalStyle.bodyWidth}" align="center" border="0" cellspacing="0" cellpadding="0" role="presentation"><tr><td width="${globalStyle.bodyWidth}" align="center" valign="top"><![endif]-->
          <table role="presentation" class="em-container" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: ${globalStyle.bodyWidth}px; margin: 0 auto; border-collapse: collapse;">
            <tbody>
${content}
${legalFooter}
            </tbody>
          </table>
          <!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`
}
