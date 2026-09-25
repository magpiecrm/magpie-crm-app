import type { EmailBlock } from '../types'

const INLINE_TAGS = ['span', 'strong', 'b', 'i', 'em', 'u', 'a', 'br']
const FOLDABLE_BG_TYPES = new Set<EmailBlock['type']>(['title', 'text', 'logo'])

const extractPx = (value?: string): number | undefined => {
  const match = value?.match(/\d+/)
  return match ? parseInt(match[0]) : undefined
}

export const parseHTMLToBlocks = (html: string): EmailBlock[] => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const parsedBlocks: EmailBlock[] = []
  let idCounter = 1

  const nextId = () => `b_imported_${idCounter++}`

  const getElementStyles = (el: HTMLElement) => {
    const styleAttr = el.getAttribute('style') || ''
    const styles: Record<string, string> = {}
    styleAttr.split(';').forEach(rule => {
      const parts = rule.split(':')
      if (parts.length === 2) {
        styles[parts[0].trim().toLowerCase()] = parts[1].trim()
      }
    })
    return styles
  }

  const traverse = (node: Node, target: EmailBlock[] = parsedBlocks) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      const tagName = el.tagName.toLowerCase()

      if (tagName === 'script' || tagName === 'style' || tagName === 'head' || tagName === 'meta' || tagName === 'title') {
        return
      }

      // Hidden preheader text (`display:none`, or the common opacity:0/max-height:0
      // combo) is invisible email-client metadata, not real content — skip it and
      // its descendants entirely.
      const ownStyles = getElementStyles(el)
      if (ownStyles['display'] === 'none' || ownStyles['visibility'] === 'hidden' || ownStyles['opacity'] === '0') {
        return
      }

      if (tagName === 'hr') {
        target.push({ id: nextId(), type: 'divider', content: '' })
        return
      }

      // A rule/border with no text content (a common `<tr><td style="border-top:...">`
      // spacer row in table-based email HTML) is a visual divider, not real content.
      if (tagName === 'td' && !el.textContent?.trim() && el.children.length === 0) {
        const s = getElementStyles(el)
        if (s['border-top'] || s['border-bottom']) {
          target.push({ id: nextId(), type: 'divider', content: '' })
          return
        }
      }

      // A container (div/section, or a table/td carrying its own background — the
      // standard way email HTML builds colored boxes/cards) wrapping other elements.
      // Recurse into its children first so the container's background and grouping
      // survive as either a 'section' block, or, if it only produced a single child,
      // folded directly onto that child (avoids pointless single-item wrappers).
      if (tagName === 'div' || tagName === 'section' || tagName === 'td' || tagName === 'table') {
        const styles = getElementStyles(el)
        const bg = styles['background-color'] || (tagName === 'td' ? el.getAttribute('bgcolor') || '' : '')
        const significantChildren = Array.from(el.children).filter(
          child => !['script', 'style'].includes(child.tagName.toLowerCase())
        ) as HTMLElement[]

        if (bg && bg !== 'transparent' && significantChildren.length >= 1) {
          const collected: EmailBlock[] = []
          significantChildren.forEach(child => traverse(child, collected))

          const paddingVal = extractPx(styles['padding'] || styles['padding-top'])
          const borderRadiusVal = extractPx(styles['border-radius'])

          if (collected.length === 1) {
            const only = collected[0]
            if (FOLDABLE_BG_TYPES.has(only.type)) {
              target.push({
                ...only,
                style: { ...only.style, bgColor: only.style?.bgColor ?? bg, padding: only.style?.padding ?? paddingVal },
              })
              return
            }
            if (only.type === 'button') {
              target.push({
                ...only,
                style: {
                  ...only.style,
                  btnBgColor: only.style?.btnBgColor ?? bg,
                  btnRadius: only.style?.btnRadius ?? borderRadiusVal,
                },
              })
              return
            }
          }

          if (collected.length > 0) {
            target.push({
              id: nextId(),
              type: 'section',
              content: '',
              children: collected,
              style: { bgColor: bg, padding: paddingVal ?? 20, borderRadius: borderRadiusVal },
            })
            return
          }
        }
      }

      if (tagName === 'img') {
        const src = el.getAttribute('src') || ''
        const alt = el.getAttribute('alt') || ''
        const styles = getElementStyles(el)

        let imgWidth = el.getAttribute('width') || styles['width']
        if (!imgWidth) {
          const parent = el.parentElement
          if (parent) {
            const parentStyles = getElementStyles(parent)
            imgWidth = parent.getAttribute('width') || parentStyles['width']
          }
        }
        if (imgWidth && !imgWidth.endsWith('px') && !imgWidth.endsWith('%') && !isNaN(Number(imgWidth))) {
          imgWidth = `${imgWidth}px`
        }

        let align: 'left' | 'center' | 'right' = 'center'
        const parent = el.parentElement
        const parentAlign = parent?.getAttribute('align') || parent?.style.textAlign
        const parentStyles = parent ? getElementStyles(parent) : {}
        if (parentAlign === 'left' || styles['margin-right'] === 'auto' && styles['margin-left'] !== 'auto' || parentStyles['text-align'] === 'left') {
          align = 'left'
        } else if (parentAlign === 'right' || styles['margin-left'] === 'auto' && styles['margin-right'] !== 'auto' || parentStyles['text-align'] === 'right') {
          align = 'right'
        } else if (parent?.style.float === 'left' || styles['float'] === 'left') {
          align = 'left'
        } else if (parent?.style.float === 'right' || styles['float'] === 'right') {
          align = 'right'
        }

        if (src && !src.includes('pixel') && !src.includes('track') && alt !== 'Mailin') {
          target.push({
            id: nextId(),
            type: 'image',
            content: src,
            width: imgWidth || undefined,
            align
          })
        }
        return
      }

      if (tagName === 'a') {
        const text = el.textContent?.trim() || ''
        const href = el.getAttribute('href') || ''
        const styles = getElementStyles(el)
        const classes = el.className || ''

        const isBtn = styles['background-color'] ||
                      styles['display'] === 'inline-block' ||
                      classes.includes('btn') ||
                      classes.includes('button')

        if (isBtn && text) {
          target.push({
            id: nextId(),
            type: 'button',
            content: text,
            url: href,
            style: {
              btnBgColor: styles['background-color'],
              btnTextColor: styles['color'],
              btnRadius: extractPx(styles['border-radius'])
            }
          })
          return
        }
      }

      const hasText = el.textContent?.trim()
      const childElements = Array.from(el.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE) as HTMLElement[]
      const hasOnlyInlineOrNoElements = childElements.every(child =>
        INLINE_TAGS.includes(child.tagName.toLowerCase()) &&
        !child.getAttribute('style')?.replace(/\s/g, '').includes('display:inline-block') &&
        !child.getAttribute('style')?.replace(/\s/g, '').includes('display:block') &&
        !child.getAttribute('style')?.includes('background-color')
      )

      if (hasText && (childElements.length === 0 || hasOnlyInlineOrNoElements)) {
        const text = el.textContent?.trim() || ''
        let styles = getElementStyles(el)

        // A block-level wrapper (e.g. <td>/<p>) often carries no styling of its own
        // and just holds a single styled inline child (e.g. <span style="color:...">) —
        // inherit that child's styling so it isn't silently dropped.
        const onlyInlineChild = childElements.length === 1 ? childElements[0] : null
        if (onlyInlineChild && !styles['color'] && !styles['font-size'] && !styles['font-weight']) {
          styles = { ...getElementStyles(onlyInlineChild), ...styles }
        }

        const fontSizeStr = styles['font-size'] || ''
        const fontWeightStr = styles['font-weight'] || ''

        let isHeading = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)

        if (!isHeading) {
          const fontSize = parseInt(fontSizeStr)
          const isBold = fontWeightStr === 'bold' || parseInt(fontWeightStr) >= 700 || tagName === 'strong' || tagName === 'b'
          if ((fontSize && fontSize >= 18) || (fontSize && fontSize >= 16 && isBold) || el.classList.contains('title') || el.classList.contains('heading')) {
            isHeading = true
          }
        }

        const isLogo = text.length < 20 && (
          tagName === 'div' && (styles['letter-spacing'] || styles['font-weight'] === '800' || styles['font-weight'] === 'extrabold')
        )

        // A small explicit width/height (e.g. a 34x34 numbered badge cell) means this
        // leaf shouldn't stretch to fill the email width like a normal paragraph.
        const widthAttr = el.getAttribute('width') || styles['width']
        const widthNum = widthAttr ? parseInt(widthAttr) : NaN
        const badgeWidth = !isNaN(widthNum) && widthNum > 0 && widthNum <= 200 ? `${widthNum}px` : undefined

        if (isLogo && text === text.toUpperCase() && text.length > 2) {
          target.push({
            id: nextId(),
            type: 'logo',
            content: text,
            width: badgeWidth,
            style: {
              color: styles['color'],
              bgColor: styles['background-color'],
              fontSize: parseInt(fontSizeStr) || undefined
            }
          })
          return
        }

        if (isHeading) {
          target.push({
            id: nextId(),
            type: 'title',
            content: text,
            align: (styles['text-align'] as any) || undefined,
            width: badgeWidth,
            style: {
              color: styles['color'],
              bgColor: styles['background-color'],
              fontSize: parseInt(fontSizeStr) || undefined,
              fontWeight: (fontWeightStr === 'normal' || fontWeightStr === 'bold') ? fontWeightStr : undefined
            }
          })
        } else {
          target.push({
            id: nextId(),
            type: 'text',
            content: text,
            align: (styles['text-align'] as any) || undefined,
            width: badgeWidth,
            style: {
              color: styles['color'],
              bgColor: styles['background-color'],
              fontSize: parseInt(fontSizeStr) || undefined
            }
          })
        }
        return
      }
    }

    for (let i = 0; i < node.childNodes.length; i++) {
      traverse(node.childNodes[i], target)
    }
  }

  traverse(doc.body)
  return parsedBlocks
}
