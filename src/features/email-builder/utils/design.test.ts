import { describe, expect, it } from 'vitest'
import { compileHTML } from './compiler'
import { DEFAULT_GLOBAL_STYLE, extractDesign } from './design'
import type { EmailBlock } from '../types'

describe('extractDesign', () => {
  it('round-trips compiled HTML, including content that would break the comment', () => {
    const blocks: EmailBlock[] = [{ id: 'b1', type: 'text', content: 'a -- b <!-- c --> d' }]
    const style = { ...DEFAULT_GLOBAL_STYLE, bodyBgColor: '#000000' }
    const design = extractDesign(compileHTML(blocks, style))
    expect(design).toEqual({ blocks, globalStyle: style })
  })

  it('fills in missing global style fields with defaults', () => {
    const html = '<!-- BLOCKS_DATA: {"blocks":[],"globalStyle":{"bodyWidth":480}} -->'
    expect(extractDesign(html)?.globalStyle).toEqual({ ...DEFAULT_GLOBAL_STYLE, bodyWidth: 480 })
  })

  it('returns null for foreign or corrupt HTML', () => {
    expect(extractDesign('<p>hello</p>')).toBeNull()
    expect(extractDesign('<!-- BLOCKS_DATA: {not json} -->')).toBeNull()
    expect(extractDesign('<!-- BLOCKS_DATA: {"globalStyle":{}} -->')).toBeNull()
  })
})
