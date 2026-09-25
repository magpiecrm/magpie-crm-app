import type { EmailBlock, GlobalStyle } from '../types'
import type { BuilderDesign } from '../applyAction'
import { EMAIL_FONT_STACKS } from './html'
import { parseHTMLToBlocks } from './parser'

export const DEFAULT_GLOBAL_STYLE: GlobalStyle = {
  bodyWidth: 600,
  bodyBgColor: '#ffffff',
  canvasBgColor: '#ffffff',
  buttonBgColor: '#27272a',
  buttonTextColor: '#ffffff',
  buttonRadius: 4,
  fontFamily: EMAIL_FONT_STACKS[0].value,
  paddingX: 20,
  paddingY: 20,
  lineHeight: 1.5,
  linkColor: '#2563eb',
  cardMode: false,
  cardRadius: 5,
  cardGap: 10,
}

/**
 * Read the block model that `compileHTML` embeds as a `BLOCKS_DATA` comment.
 *
 * String-only (no DOM), so the server — copilot tools, template storage — can
 * use it as well as the browser. Returns null for HTML the builder didn't
 * produce.
 */
export function extractDesign(html: string): BuilderDesign | null {
  const match = html.match(/<!-- BLOCKS_DATA: ([\s\S]*?) -->/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    if (!Array.isArray(parsed.blocks)) return null
    return {
      blocks: parsed.blocks as EmailBlock[],
      globalStyle: { ...DEFAULT_GLOBAL_STYLE, ...(parsed.globalStyle ?? {}) },
    }
  } catch (e) {
    console.error('Failed to parse blocks metadata', e)
    return null
  }
}

/**
 * Turn any stored email HTML into an editable design. Falls back from the
 * embedded block model, to a best-effort DOM parse, to a single raw `html`
 * block. Browser-only: the DOM parse needs `DOMParser`.
 */
export function loadDesign(html: string): BuilderDesign {
  const blank = { blocks: [], globalStyle: DEFAULT_GLOBAL_STYLE }
  if (!html || !html.trim()) return blank

  const embedded = extractDesign(html)
  if (embedded) return embedded

  // The wizard's placeholder body for a brand-new campaign.
  const isBlank = html.includes('This is a test campaign.') || html.includes('Hello!')
  if (isBlank) return blank

  try {
    const parsedBlocks = parseHTMLToBlocks(html)
    if (parsedBlocks.length > 0) return { blocks: parsedBlocks, globalStyle: DEFAULT_GLOBAL_STYLE }
  } catch (e) {
    console.error('HTML DOM Parsing failed, falling back to raw block', e)
  }

  return {
    blocks: [{ id: 'imported_html', type: 'html', content: html }],
    globalStyle: DEFAULT_GLOBAL_STYLE,
  }
}
