import { describe, expect, it } from 'vitest'
import { compileHTML } from './compiler'
import { DEFAULT_GLOBAL_STYLE } from './design'
import { STARTER_TEMPLATES } from '../templates/starters'
import type { EmailBlock } from '../types'

const item = (n: number) => ({ id: `i${n}`, image: `https://example.com/${n}.jpg`, title: `Item ${n}`, text: '' })

describe('grid gutters', () => {
  it('pads the cells, not the column tables, so the gap shows', () => {
    const html = compileHTML([{ id: 'c', type: 'columns', content: '', items: [item(1), item(2), item(3)] } as EmailBlock], DEFAULT_GLOBAL_STYLE)
    const pads = [...html.matchAll(/<td class="xs-col-pad" style="padding: 0 (\d+)px 0 (\d+)px;">/g)].map((m) => [Number(m[1]), Number(m[2])])
    expect(pads).toHaveLength(3)
    // Every column gives up the same total, so all three images are the same width.
    const totals = pads.map(([right, left]) => right + left)
    expect(new Set(totals).size).toBe(1)
    // Outer edges stay flush with the text above and below.
    expect(pads[0][1]).toBe(0)
    expect(pads[2][0]).toBe(0)
  })

  it('drops the gutter once columns stack on a phone', () => {
    const html = compileHTML([], DEFAULT_GLOBAL_STYLE)
    expect(html).toMatch(/\.xs-col-pad \{ padding-left: 0 !important; padding-right: 0 !important; \}/)
  })
})

describe('starter templates', () => {
  it.each(STARTER_TEMPLATES.map((t) => [t.id, t] as const))('%s has exactly one unsubscribe link', (_id, starter) => {
    if (starter.id === 'password-reset') return // an account email, not a marketing one
    const html = compileHTML(starter.build(), { ...DEFAULT_GLOBAL_STYLE, ...starter.globalStyle })
    // Counted in links: the embedded block model names it too.
    expect(html.match(/href="\{\{ unsubscribe \}\}"/g)).toHaveLength(1)
  })
})

describe('outline buttons', () => {
  it("set their label in the outline's colour, not the filled buttons' white", () => {
    const html = compileHTML([{ id: 'b', type: 'button', content: 'Read more', url: '#', style: { btnVariant: 'outline', btnBgColor: '#1d4ed8' } } as EmailBlock], DEFAULT_GLOBAL_STYLE)
    expect(html).toContain('border: 2px solid #1d4ed8; color: #1d4ed8;')
  })

  it('keep a text colour the block sets', () => {
    const html = compileHTML([{ id: 's', type: 'split', content: 'Story', subContent: '', url: '#', style: { btnVariant: 'outline', btnBgColor: '#1d4ed8', btnTextColor: '#111827' } } as EmailBlock], DEFAULT_GLOBAL_STYLE)
    expect(html).toContain('border: 2px solid #1d4ed8; color: #111827;')
  })
})
