import { Plus, Trash2 } from 'lucide-react'
import type { EmailBlock, EmailBlockItem, EmailLink, EmailSocialLink, EmailSummaryRow } from '../types'
import { BLOCK_PADDING_DEFAULTS, resolvePadding } from '../utils/html'
import { ImageUrlField } from './ImageUrlField'

const inputClass =
  'w-full px-2 py-1.5 bg-muted border border-border rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent'
const labelClass = 'block text-[10px] text-muted-foreground font-semibold uppercase tracking-wider'
const sectionLabelClass =
  'block text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/50 pb-1.5'

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`

/**
 * The padding/alt controls only read `type`, `style` and `alt`, so they are
 * generic over the block shape and shared with the survey builder.
 */
type PaddedBlock = { type: string; alt?: string; style?: EmailBlock['style'] }

interface ControlProps<B extends PaddedBlock = EmailBlock> {
  block: B
  update: (updates: Partial<B>) => void
}

const SIDES = [
  { key: 'paddingTop', label: 'Top', index: 0 },
  { key: 'paddingRight', label: 'Right', index: 1 },
  { key: 'paddingBottom', label: 'Bottom', index: 2 },
  { key: 'paddingLeft', label: 'Left', index: 3 },
] as const

/**
 * Per-side spacing. The compiler puts all block spacing in cell padding
 * (Outlook's Word engine drops margins), so this is the only spacing control.
 */
export function PaddingControl<B extends PaddedBlock>({
  block,
  update,
  defaults,
}: ControlProps<B> & { defaults?: [number, number, number, number] }) {
  const resolved = resolvePadding(block.style, defaults ?? BLOCK_PADDING_DEFAULTS[block.type as EmailBlock['type']])
  const isDefault = SIDES.every(s => block.style?.[s.key] == null) && block.style?.padding == null

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className={labelClass}>Spacing (px)</label>
        {!isDefault && (
          <button
            type="button"
            onClick={() =>
              update({
                style: { ...block.style, padding: undefined, paddingTop: undefined, paddingRight: undefined, paddingBottom: undefined, paddingLeft: undefined },
              } as Partial<B>)
            }
            className="text-[10px] text-accent hover:underline font-semibold"
          >
            Reset
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {SIDES.map(side => (
          <div key={side.key} className="space-y-1">
            <span className="block text-[9px] text-muted-foreground/70 text-center">{side.label}</span>
            <input
              type="number"
              min={0}
              value={resolved[side.index]}
              onChange={e =>
                update({ style: { ...block.style, padding: undefined, [side.key]: Math.max(0, parseInt(e.target.value) || 0) } } as Partial<B>)
              }
              className={`${inputClass} text-center px-1`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Alternative text — shown when images are blocked, which is the default in Outlook. */
export function AltTextControl<B extends PaddedBlock>({ block, update }: ControlProps<B>) {
  return (
    <div className="space-y-2">
      <label className={labelClass}>Alt text</label>
      <input
        type="text"
        value={block.alt || ''}
        placeholder="Describe the image"
        onChange={e => update({ alt: e.target.value } as Partial<B>)}
        className={inputClass}
      />
      <p className="text-[10px] text-muted-foreground/70 leading-snug">
        Shown when images are blocked — which is the default in Outlook and many corporate clients.
      </p>
    </div>
  )
}

export function LinkListEditor({
  label,
  links,
  onChange,
}: {
  label: string
  links: EmailLink[]
  onChange: (links: EmailLink[]) => void
}) {
  const patch = (index: number, updates: Partial<EmailLink>) =>
    onChange(links.map((l, i) => (i === index ? { ...l, ...updates } : l)))

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className={labelClass}>{label}</label>
        <button
          type="button"
          onClick={() => onChange([...links, { id: newId('lnk'), label: 'New link', url: '#' }])}
          className="flex items-center gap-1 text-[10px] text-accent hover:underline font-semibold"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {links.length === 0 && <p className="text-[10px] text-muted-foreground/70">No links yet.</p>}
      {links.map((link, index) => (
        <div key={link.id} className="flex gap-1.5 items-center">
          <input
            type="text"
            value={link.label}
            placeholder="Label"
            onChange={e => patch(index, { label: e.target.value })}
            className={`${inputClass} flex-1`}
          />
          <input
            type="text"
            value={link.url}
            placeholder="URL"
            onChange={e => patch(index, { url: e.target.value })}
            className={`${inputClass} flex-1 font-mono text-[10px]`}
          />
          <button
            type="button"
            onClick={() => onChange(links.filter((_, i) => i !== index))}
            className="p-1 text-muted-foreground hover:text-destructive transition-colors shrink-0"
            title="Remove link"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function SocialListEditor({
  socials,
  onChange,
}: {
  socials: EmailSocialLink[]
  onChange: (socials: EmailSocialLink[]) => void
}) {
  const patch = (index: number, updates: Partial<EmailSocialLink>) =>
    onChange(socials.map((s, i) => (i === index ? { ...s, ...updates } : s)))

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className={labelClass}>Social profiles</label>
        <button
          type="button"
          onClick={() => onChange([...socials, { id: newId('soc'), label: 'Twitter', url: '#' }])}
          className="flex items-center gap-1 text-[10px] text-accent hover:underline font-semibold"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {socials.length === 0 && (
        <p className="text-[10px] text-muted-foreground/70 leading-snug">
          None yet. Without an icon URL a profile renders as a text link.
        </p>
      )}
      {socials.map((social, index) => (
        <div key={social.id} className="p-2.5 bg-muted/30 border border-border/60 rounded-xl space-y-1.5">
          <div className="flex gap-1.5 items-center">
            <input
              type="text"
              value={social.label}
              placeholder="Name"
              onChange={e => patch(index, { label: e.target.value })}
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              onClick={() => onChange(socials.filter((_, i) => i !== index))}
              className="p-1 text-muted-foreground hover:text-destructive transition-colors shrink-0"
              title="Remove profile"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            type="text"
            value={social.url}
            placeholder="Profile URL"
            onChange={e => patch(index, { url: e.target.value })}
            className={`${inputClass} font-mono text-[10px]`}
          />
          <input
            type="text"
            value={social.icon || ''}
            placeholder="Icon image URL (optional)"
            onChange={e => patch(index, { icon: e.target.value })}
            className={`${inputClass} font-mono text-[10px]`}
          />
        </div>
      ))}
    </div>
  )
}

/** Card grid editor shared by `columns`, `articles` and `product`. */
export function ItemListEditor({
  label,
  items,
  onChange,
  showPrice = false,
  showUrl = true,
  showQty = false,
  showBadge = false,
  showImage = true,
}: {
  label: string
  items: EmailBlockItem[]
  onChange: (items: EmailBlockItem[]) => void
  showPrice?: boolean
  showUrl?: boolean
  showQty?: boolean
  showBadge?: boolean
  showImage?: boolean
}) {
  const patch = (index: number, updates: Partial<EmailBlockItem>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...updates } : item)))

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <label className={sectionLabelClass}>{label}</label>
        <button
          type="button"
          onClick={() =>
            onChange([...items, { id: newId('it'), image: 'https://via.placeholder.com/400x400', title: 'New item', text: '', url: '#' }])
          }
          className="flex items-center gap-1 text-[10px] text-accent hover:underline font-semibold shrink-0 ml-2"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {items.length === 0 && <p className="text-[10px] text-muted-foreground/70">No items yet.</p>}
      {items.map((item, index) => (
        <div key={item.id} className="p-3 bg-muted/30 border border-border/60 rounded-xl space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold text-accent">Item {index + 1}</span>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
            >
              Remove
            </button>
          </div>
          <input type="text" value={item.title} placeholder="Title" onChange={e => patch(index, { title: e.target.value })} className={inputClass} />
          <textarea
            value={item.text}
            placeholder="Description"
            onChange={e => patch(index, { text: e.target.value })}
            className={`${inputClass} h-12 resize-none`}
          />
          {showBadge && (
            <div className="flex gap-1.5 items-center">
              <input type="text" value={item.badge || ''} placeholder="Badge (e.g. ALERT)" onChange={e => patch(index, { badge: e.target.value })} className={`${inputClass} flex-1`} />
              <input
                type="color"
                value={item.badgeColor || '#6b7280'}
                onChange={e => patch(index, { badgeColor: e.target.value })}
                className="w-8 h-7 border border-border rounded cursor-pointer bg-transparent shrink-0"
                title="Badge colour"
              />
            </div>
          )}
          {showQty && (
            <div className="flex gap-1.5">
              <input type="text" value={item.qty || ''} placeholder="Qty" onChange={e => patch(index, { qty: e.target.value })} className={inputClass} />
              <input type="text" value={item.price || ''} placeholder="Price" onChange={e => patch(index, { price: e.target.value })} className={inputClass} />
            </div>
          )}
          {showPrice && (
            <div className="flex gap-1.5">
              <input type="text" value={item.price || ''} placeholder="Price" onChange={e => patch(index, { price: e.target.value })} className={inputClass} />
              <input
                type="text"
                value={item.comparePrice || ''}
                placeholder="Was"
                onChange={e => patch(index, { comparePrice: e.target.value })}
                className={inputClass}
              />
            </div>
          )}
          {showImage && (
            <>
              <ImageUrlField
                value={item.image}
                onChange={url => patch(index, { image: url })}
                placeholder="Image URL"
                compact
              />
              <input type="text" value={item.alt || ''} placeholder="Alt text" onChange={e => patch(index, { alt: e.target.value })} className={inputClass} />
            </>
          )}
          {showUrl && (
            <input
              type="text"
              value={item.url || ''}
              placeholder="Link URL"
              onChange={e => patch(index, { url: e.target.value })}
              className={`${inputClass} font-mono text-[10px]`}
            />
          )}
        </div>
      ))}
    </div>
  )
}

/** Label/value totals under a receipt table. */
export function SummaryRowEditor({
  rows,
  onChange,
}: {
  rows: EmailSummaryRow[]
  onChange: (rows: EmailSummaryRow[]) => void
}) {
  const patch = (index: number, updates: Partial<EmailSummaryRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...updates } : r)))

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className={labelClass}>Totals</label>
        <button
          type="button"
          onClick={() => onChange([...rows, { id: newId('sum'), label: 'Subtotal', value: '' }])}
          className="flex items-center gap-1 text-[10px] text-accent hover:underline font-semibold"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {rows.length === 0 && <p className="text-[10px] text-muted-foreground/70">No totals rows yet.</p>}
      {rows.map((row, index) => (
        <div key={row.id} className="flex gap-1.5 items-center">
          <input
            type="text"
            value={row.label}
            placeholder="Label"
            onChange={e => patch(index, { label: e.target.value })}
            className={`${inputClass} flex-1`}
          />
          <input
            type="text"
            value={row.value}
            placeholder="Value"
            onChange={e => patch(index, { value: e.target.value })}
            className={`${inputClass} w-20`}
          />
          <button
            type="button"
            onClick={() => patch(index, { emphasis: !row.emphasis })}
            className={`px-1.5 py-1 rounded border text-[10px] font-bold shrink-0 transition-colors ${
              row.emphasis ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'
            }`}
            title="Emphasise this row (use for the final total)"
          >
            B
          </button>
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            className="p-1 text-muted-foreground hover:text-destructive transition-colors shrink-0"
            title="Remove row"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
