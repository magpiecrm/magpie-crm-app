import { AlignLeft, AlignCenter, AlignRight, AlignJustify } from 'lucide-react'
import type { EmailBlock, GlobalStyle } from '../types'
import { AltTextControl, ItemListEditor, LinkListEditor, PaddingControl, SocialListEditor, SummaryRowEditor } from './BlockEditorControls'
import { ImageUrlField } from './ImageUrlField'
import { SurveyBlockFields } from './SurveyBlockFields'

interface BlockEditorProps {
  selectedBlock: EmailBlock
  globalStyle: GlobalStyle
  updateBlockContent: (id: string, updates: Partial<EmailBlock>) => void
}

export function BlockEditor({ selectedBlock, globalStyle, updateBlockContent }: BlockEditorProps) {
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {selectedBlock.type === 'survey' && (
        <SurveyBlockFields block={selectedBlock} update={(updates) => updateBlockContent(selectedBlock.id, updates)} />
      )}

      {/* Converting to or from a survey block would strand its survey link, so it has no type picker. */}
      {selectedBlock.type !== 'survey' && <div className="space-y-2">
        <label className="block text-xs text-muted-foreground font-semibold">Block Type</label>
        <select
          value={selectedBlock.type}
          onChange={(e) => {
            const newType = e.target.value as EmailBlock['type']
            const updates: Partial<EmailBlock> = { type: newType }
            if (newType === 'title') {
              updates.style = { ...selectedBlock.style, fontSize: 24, fontWeight: 'bold' }
            } else if (newType === 'text') {
              updates.style = { ...selectedBlock.style, fontSize: 15, fontWeight: 'normal' }
            } else if (newType === 'button') {
              if (!selectedBlock.url) updates.url = '#'
              updates.style = { 
                ...selectedBlock.style, 
                btnBgColor: selectedBlock.style?.btnBgColor ?? globalStyle.buttonBgColor,
                btnTextColor: selectedBlock.style?.btnTextColor ?? globalStyle.buttonTextColor,
                btnRadius: selectedBlock.style?.btnRadius ?? globalStyle.buttonRadius
              }
            } else if (newType === 'image') {
              if (!selectedBlock.content || !selectedBlock.content.startsWith('http')) {
                updates.content = 'https://via.placeholder.com/600x300'
              }
            } else if (newType === 'video') {
              if (!selectedBlock.content || !selectedBlock.content.startsWith('http')) {
                updates.content = 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop'
              }
              if (!selectedBlock.url) updates.url = '#'
            } else if (newType === 'spacer') {
              updates.content = '30'
            } else if (newType === 'articles' || newType === 'product' || newType === 'columns') {
              if (!selectedBlock.items?.length) {
                updates.items = [
                  { id: 'it_' + Math.random().toString(36).slice(2, 9), image: 'https://via.placeholder.com/400x400', title: 'First item', text: 'Short description.', url: '#' },
                  { id: 'it_' + Math.random().toString(36).slice(2, 9), image: 'https://via.placeholder.com/400x400', title: 'Second item', text: 'Short description.', url: '#' },
                ]
              }
              if (newType === 'product' && !selectedBlock.content) updates.content = 'Buy now'
            } else if (newType === 'receipt') {
              if (!selectedBlock.content) updates.content = 'Order summary'
              if (!selectedBlock.items?.length) {
                updates.items = [{ id: 'it_' + Math.random().toString(36).slice(2, 9), image: '', title: 'Product name', text: '', qty: '1', price: '' }]
              }
              if (!selectedBlock.summaryRows?.length) {
                updates.summaryRows = [{ id: 'sum_' + Math.random().toString(36).slice(2, 9), label: 'Total', value: '', emphasis: true }]
              }
            } else if (newType === 'notice') {
              if (!selectedBlock.content) updates.content = 'Details'
              if (!selectedBlock.items?.length) {
                updates.items = [{ id: 'it_' + Math.random().toString(36).slice(2, 9), image: '', title: 'Notification title', text: 'What happened and what to do next.', badge: 'INFO', badgeColor: '#2563eb', url: '#' }]
              }
            } else if (newType === 'navigation') {
              if (!selectedBlock.content) updates.content = 'MY BRAND'
            } else if (newType === 'footer') {
              if (!selectedBlock.content) updates.content = 'Your Company Ltd, 123 Example Street'
            }
            updateBlockContent(selectedBlock.id, updates)
          }}
          className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs"
        >
          <option value="title">Heading / Title</option>
          <option value="text">Paragraph / Body Text</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
          <option value="button">Button</option>
          <option value="dynamic">Dynamic Content</option>
          <option value="logo">Logo</option>
          <option value="social">Social Media</option>
          <option value="html">Custom HTML</option>
          <option value="divider">Divider</option>
          <option value="spacer">Spacer</option>
          <option value="split">Split Row</option>
          <option value="columns">3-Column Cards</option>
          <option value="articles">Article Cards</option>
          <option value="product">Product Grid</option>
          <option value="receipt">Order Receipt</option>
          <option value="notice">Notification List</option>
          <option value="navigation">Navigation Bar</option>
          <option value="footer">Footer</option>
          <option value="section">Section / Card</option>
        </select>
      </div>}

      {selectedBlock.type === 'title' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Heading Text</label>
            <input
              type="text"
              value={selectedBlock.content}
              onChange={(e) => updateBlockContent(selectedBlock.id, { content: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex gap-2 pt-1 flex-wrap">
              <button type="button" onClick={() => updateBlockContent(selectedBlock.id, { content: selectedBlock.content + ' {{contact.FIRSTNAME}}' })} className="px-2 py-1 bg-background border border-border rounded text-[10px] hover:bg-muted text-muted-foreground transition-colors">{'{{contact.FIRSTNAME}}'}</button>
              <button type="button" onClick={() => updateBlockContent(selectedBlock.id, { content: selectedBlock.content + ' {{contact.LASTNAME}}' })} className="px-2 py-1 bg-background border border-border rounded text-[10px] hover:bg-muted text-muted-foreground transition-colors">{'{{contact.LASTNAME}}'}</button>
              <button type="button" onClick={() => updateBlockContent(selectedBlock.id, { content: selectedBlock.content + ' {{contact.COMPANY}}' })} className="px-2 py-1 bg-background border border-border rounded text-[10px] hover:bg-muted text-muted-foreground transition-colors">{'{{contact.COMPANY}}'}</button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Heading Preset</label>
            <div className="grid grid-cols-4 gap-1">
              {([
                { label: 'H1', size: 28 },
                { label: 'H2', size: 22 },
                { label: 'H3', size: 18 },
                { label: 'H4', size: 16 }
              ]).map(preset => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, fontSize: preset.size, fontWeight: 'bold' } })}
                  className={`py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                    (selectedBlock.style?.fontSize === preset.size) 
                      ? 'border-accent bg-accent/10 text-accent font-bold' 
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Block Position on Page</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map(a => (
                <button key={a} onClick={() => updateBlockContent(selectedBlock.id, { align: a })}
                  className={`flex-1 py-1.5 flex justify-center rounded-md border transition-colors ${(selectedBlock.align || 'left') === a ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  {a === 'left' ? <span className="text-xs">Left</span> : a === 'center' ? <span className="text-xs">Center</span> : <span className="text-xs">Right</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Text Alignment</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right', 'justify'] as const).map(t => (
                <button key={t} onClick={() => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, textAlign: t } })}
                  className={`flex-1 py-1.5 flex justify-center rounded-md border transition-colors ${(selectedBlock.style?.textAlign ?? selectedBlock.align ?? 'left') === t ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  {t === 'left' ? <AlignLeft className="w-4 h-4" /> : t === 'center' ? <AlignCenter className="w-4 h-4" /> : t === 'right' ? <AlignRight className="w-4 h-4" /> : <AlignJustify className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
          {/* Style overrides */}
          <div className="pt-3 border-t border-border/40 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Style</span>
              {selectedBlock.style && (
                <button onClick={() => updateBlockContent(selectedBlock.id, { style: undefined })} className="text-[10px] text-muted-foreground hover:text-destructive transition-colors">↺ Reset</button>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Font Family</label>
              <select
                value={selectedBlock.style?.fontFamily ?? ''}
                onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, fontFamily: e.target.value || undefined } })}
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs"
              >
                <option value="">Default (Inherit)</option>
                <option value="sans-serif">System Sans</option>
                <option value="'Inter', sans-serif">Inter</option>
                <option value="'Roboto', sans-serif">Roboto</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="'Playfair Display', serif">Playfair Display</option>
                <option value="'Courier New', monospace">Monospace</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Text color</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={selectedBlock.style?.color ?? '#111827'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, color: e.target.value } })} className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent flex-shrink-0" />
                <input type="text" value={selectedBlock.style?.color ?? '#111827'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, color: e.target.value } })} className="flex-1 px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Background</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={selectedBlock.style?.bgColor ?? '#ffffff'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, bgColor: e.target.value } })} className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent flex-shrink-0" />
                <input type="text" value={selectedBlock.style?.bgColor ?? ''} placeholder="none" onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, bgColor: e.target.value || undefined } })} className="flex-1 px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="font-semibold">Font size</span>
                <span className="font-bold text-foreground">{selectedBlock.style?.fontSize ?? 24}px</span>
              </div>
              <input type="range" min="12" max="48" step="1" value={selectedBlock.style?.fontSize ?? 24} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, fontSize: parseInt(e.target.value) } })} className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Weight</label>
              <div className="flex gap-1">
                <button onClick={() => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, fontWeight: 'normal' } })} className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${(selectedBlock.style?.fontWeight ?? 'bold') === 'normal' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>Normal</button>
                <button onClick={() => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, fontWeight: 'bold' } })} className={`flex-1 py-1.5 text-xs font-bold rounded-md border transition-colors ${(selectedBlock.style?.fontWeight ?? 'bold') === 'bold' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>Bold</button>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="font-semibold">Padding</span>
                <span className="font-bold text-foreground">{selectedBlock.style?.padding ?? 0}px</span>
              </div>
              <input type="range" min="0" max="40" step="2" value={selectedBlock.style?.padding ?? 0} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, padding: parseInt(e.target.value) } })} className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer" />
            </div>
          </div>
        </div>
      )}

      {selectedBlock.type === 'logo' && (
        <div className="space-y-3">
          <div className="space-y-2">
            {/* This one field does double duty: plain text renders as a
                wordmark, a URL (pasted or uploaded) renders as an <img> —
                see the isImage sniff in compiler.ts's renderLogo. */}
            <ImageUrlField
              label="Logo Text or Image"
              value={selectedBlock.content}
              onChange={(url) => updateBlockContent(selectedBlock.id, { content: url })}
              placeholder="Type a wordmark, or upload/paste an image"
            />
            <p className="text-[10px] text-muted-foreground/70 leading-snug">
              Uploading or pasting an image URL replaces the text logo.
            </p>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Alignment</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map(a => (
                <button key={a} onClick={() => updateBlockContent(selectedBlock.id, { align: a })}
                  className={`flex-1 py-1.5 flex justify-center rounded-md border transition-colors ${(selectedBlock.align || 'center') === a ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  {a === 'left' ? <AlignLeft className="w-4 h-4" /> : a === 'center' ? <AlignCenter className="w-4 h-4" /> : <AlignRight className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
          {/* Style overrides */}
          <div className="pt-3 border-t border-border/40 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Style</span>
              {selectedBlock.style && (
                <button onClick={() => updateBlockContent(selectedBlock.id, { style: undefined })} className="text-[10px] text-muted-foreground hover:text-destructive transition-colors">↺ Reset</button>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Text color</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={selectedBlock.style?.color ?? '#111827'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, color: e.target.value } })} className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent flex-shrink-0" />
                <input type="text" value={selectedBlock.style?.color ?? '#111827'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, color: e.target.value } })} className="flex-1 px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Background</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={selectedBlock.style?.bgColor ?? '#ffffff'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, bgColor: e.target.value } })} className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent flex-shrink-0" />
                <input type="text" value={selectedBlock.style?.bgColor ?? ''} placeholder="none" onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, bgColor: e.target.value || undefined } })} className="flex-1 px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="font-semibold">Font size</span>
                <span className="font-bold text-foreground">{selectedBlock.style?.fontSize ?? 20}px</span>
              </div>
              <input type="range" min="10" max="36" step="1" value={selectedBlock.style?.fontSize ?? 20} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, fontSize: parseInt(e.target.value) } })} className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer" />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="font-semibold">Padding</span>
                <span className="font-bold text-foreground">{selectedBlock.style?.padding ?? 0}px</span>
              </div>
              <input type="range" min="0" max="40" step="2" value={selectedBlock.style?.padding ?? 0} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, padding: parseInt(e.target.value) } })} className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer" />
            </div>
          </div>
        </div>
      )}

      {selectedBlock.type === 'text' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Paragraph text</label>
            <textarea
              value={selectedBlock.content}
              onChange={(e) => updateBlockContent(selectedBlock.id, { content: e.target.value })}
              className="w-full h-32 px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-sm resize-none"
            />
            <div className="flex gap-2 pt-1 flex-wrap">
              <button type="button" onClick={() => updateBlockContent(selectedBlock.id, { content: selectedBlock.content + ' {{contact.FIRSTNAME}}' })} className="px-2 py-1 bg-background border border-border rounded text-[10px] hover:bg-muted text-muted-foreground transition-colors">{'{{contact.FIRSTNAME}}'}</button>
              <button type="button" onClick={() => updateBlockContent(selectedBlock.id, { content: selectedBlock.content + ' {{contact.LASTNAME}}' })} className="px-2 py-1 bg-background border border-border rounded text-[10px] hover:bg-muted text-muted-foreground transition-colors">{'{{contact.LASTNAME}}'}</button>
              <button type="button" onClick={() => updateBlockContent(selectedBlock.id, { content: selectedBlock.content + ' {{contact.COMPANY}}' })} className="px-2 py-1 bg-background border border-border rounded text-[10px] hover:bg-muted text-muted-foreground transition-colors">{'{{contact.COMPANY}}'}</button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Block Position on Page</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map(a => (
                <button key={a} onClick={() => updateBlockContent(selectedBlock.id, { align: a })}
                  className={`flex-1 py-1.5 flex justify-center rounded-md border transition-colors ${(selectedBlock.align || 'left') === a ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  {a === 'left' ? <span className="text-xs">Left</span> : a === 'center' ? <span className="text-xs">Center</span> : <span className="text-xs">Right</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Text Alignment</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right', 'justify'] as const).map(t => (
                <button key={t} onClick={() => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, textAlign: t } })}
                  className={`flex-1 py-1.5 flex justify-center rounded-md border transition-colors ${(selectedBlock.style?.textAlign ?? selectedBlock.align ?? 'left') === t ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  {t === 'left' ? <AlignLeft className="w-4 h-4" /> : t === 'center' ? <AlignCenter className="w-4 h-4" /> : t === 'right' ? <AlignRight className="w-4 h-4" /> : <AlignJustify className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
          {/* Style overrides */}
          <div className="pt-3 border-t border-border/40 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Style</span>
              {selectedBlock.style && (
                <button onClick={() => updateBlockContent(selectedBlock.id, { style: undefined })} className="text-[10px] text-muted-foreground hover:text-destructive transition-colors">↺ Reset</button>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Font Family</label>
              <select
                value={selectedBlock.style?.fontFamily ?? ''}
                onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, fontFamily: e.target.value || undefined } })}
                className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs"
              >
                <option value="">Default (Inherit)</option>
                <option value="sans-serif">System Sans</option>
                <option value="'Inter', sans-serif">Inter</option>
                <option value="'Roboto', sans-serif">Roboto</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="'Playfair Display', serif">Playfair Display</option>
                <option value="'Courier New', monospace">Monospace</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Text color</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={selectedBlock.style?.color ?? '#4b5563'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, color: e.target.value } })} className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent flex-shrink-0" />
                <input type="text" value={selectedBlock.style?.color ?? '#4b5563'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, color: e.target.value } })} className="flex-1 px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Background</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={selectedBlock.style?.bgColor ?? '#ffffff'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, bgColor: e.target.value } })} className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent flex-shrink-0" />
                <input type="text" value={selectedBlock.style?.bgColor ?? ''} placeholder="none" onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, bgColor: e.target.value || undefined } })} className="flex-1 px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="font-semibold">Font size</span>
                <span className="font-bold text-foreground">{selectedBlock.style?.fontSize ?? 15}px</span>
              </div>
              <input type="range" min="10" max="32" step="1" value={selectedBlock.style?.fontSize ?? 15} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, fontSize: parseInt(e.target.value) } })} className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Weight</label>
              <div className="flex gap-1">
                <button onClick={() => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, fontWeight: 'normal' } })} className={`flex-1 py-1.5 text-xs rounded-md border transition-colors ${(selectedBlock.style?.fontWeight ?? 'normal') === 'normal' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>Normal</button>
                <button onClick={() => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, fontWeight: 'bold' } })} className={`flex-1 py-1.5 text-xs font-bold rounded-md border transition-colors ${(selectedBlock.style?.fontWeight ?? 'normal') === 'bold' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>Bold</button>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="font-semibold">Padding</span>
                <span className="font-bold text-foreground">{selectedBlock.style?.padding ?? 0}px</span>
              </div>
              <input type="range" min="0" max="40" step="2" value={selectedBlock.style?.padding ?? 0} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, padding: parseInt(e.target.value) } })} className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer" />
            </div>
          </div>
        </div>
      )}

      {selectedBlock.type === 'image' && (
        <div className="space-y-4">
          <ImageUrlField
            label="Image URL"
            value={selectedBlock.content}
            onChange={(url) => updateBlockContent(selectedBlock.id, { content: url })}
          />
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Alignment</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map(a => (
                <button key={a} onClick={() => updateBlockContent(selectedBlock.id, { align: a })}
                  className={`flex-1 py-1.5 flex justify-center rounded-md border transition-colors ${(selectedBlock.align || 'center') === a ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  {a === 'left' ? <AlignLeft className="w-4 h-4" /> : a === 'center' ? <AlignCenter className="w-4 h-4" /> : <AlignRight className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
          {selectedBlock.content && (
            <div className="border border-border/50 rounded-lg overflow-hidden bg-muted p-1">
              <img src={selectedBlock.content} alt="Preview" className="max-h-32 mx-auto rounded object-cover" style={{ width: selectedBlock.width || '100%', maxWidth: '100%' }} />
            </div>
          )}
        </div>
      )}

      {selectedBlock.type === 'video' && (
        <div className="space-y-3">
          <ImageUrlField
            label="Cover Image URL"
            value={selectedBlock.content}
            onChange={(url) => updateBlockContent(selectedBlock.id, { content: url })}
          />
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Video Link (YouTube/Vimeo)</label>
            <input
              type="text"
              value={selectedBlock.url || ''}
              onChange={(e) => updateBlockContent(selectedBlock.id, { url: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-xs"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Alignment</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map(a => (
                <button key={a} onClick={() => updateBlockContent(selectedBlock.id, { align: a })}
                  className={`flex-1 py-1.5 flex justify-center rounded-md border transition-colors ${(selectedBlock.align || 'center') === a ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  {a === 'left' ? <AlignLeft className="w-4 h-4" /> : a === 'center' ? <AlignCenter className="w-4 h-4" /> : <AlignRight className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedBlock.type === 'button' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Button Label</label>
            <input
              type="text"
              value={selectedBlock.content}
              onChange={(e) => updateBlockContent(selectedBlock.id, { content: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Target URL</label>
            <input
              type="text"
              value={selectedBlock.url || ''}
              onChange={(e) => updateBlockContent(selectedBlock.id, { url: e.target.value })}
              placeholder="https://example.com"
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-xs"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Alignment</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map(a => (
                <button key={a} onClick={() => updateBlockContent(selectedBlock.id, { align: a })}
                  className={`flex-1 py-1.5 flex justify-center rounded-md border transition-colors ${(selectedBlock.align || 'left') === a ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  {a === 'left' ? <AlignLeft className="w-4 h-4" /> : a === 'center' ? <AlignCenter className="w-4 h-4" /> : <AlignRight className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>
          {/* Button style overrides */}
          <div className="pt-3 border-t border-border/40 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Style overrides</span>
              {selectedBlock.style && (
                <button onClick={() => updateBlockContent(selectedBlock.id, { style: undefined })} className="text-[10px] text-muted-foreground hover:text-destructive transition-colors">↺ Reset</button>
              )}
            </div>
            {/* Live preview of the button */}
            <div className="flex justify-center py-2">
              <span 
                className="text-xs font-bold px-5 py-2 pointer-events-none" 
                style={{ 
                  backgroundColor: selectedBlock.style?.btnVariant === 'outline' ? 'transparent' : (selectedBlock.style?.btnBgColor ?? globalStyle.buttonBgColor), 
                  border: selectedBlock.style?.btnVariant === 'outline' ? `2px solid ${selectedBlock.style?.btnBgColor ?? globalStyle.buttonBgColor}` : undefined,
                  color: selectedBlock.style?.btnVariant === 'outline' ? (selectedBlock.style?.btnTextColor ?? selectedBlock.style?.btnBgColor ?? globalStyle.buttonBgColor) : (selectedBlock.style?.btnTextColor ?? globalStyle.buttonTextColor), 
                  borderRadius: `${selectedBlock.style?.btnRadius ?? globalStyle.buttonRadius}px` 
                }}
              >
                {selectedBlock.content || 'Button'}
              </span>
            </div>
            
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Button Style</label>
              <div className="flex gap-1">
                {(['solid', 'outline'] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, btnVariant: v } })}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                      (selectedBlock.style?.btnVariant ?? 'solid') === v
                        ? 'border-accent bg-accent/10 text-accent font-bold'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {v === 'solid' ? 'Solid' : 'Outline'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Background Color</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={selectedBlock.style?.btnBgColor ?? globalStyle.buttonBgColor} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, btnBgColor: e.target.value } })} className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent flex-shrink-0" />
                <input type="text" value={selectedBlock.style?.btnBgColor ?? globalStyle.buttonBgColor} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, btnBgColor: e.target.value } })} className="flex-1 px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Text Color</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={selectedBlock.style?.btnTextColor ?? globalStyle.buttonTextColor} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, btnTextColor: e.target.value } })} className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent flex-shrink-0" />
                <input type="text" value={selectedBlock.style?.btnTextColor ?? globalStyle.buttonTextColor} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, btnTextColor: e.target.value } })} className="flex-1 px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="font-semibold">Rounded corners</span>
                <span className="font-bold text-foreground">{selectedBlock.style?.btnRadius ?? globalStyle.buttonRadius}px</span>
              </div>
              <input type="range" min="0" max="24" step="1" value={selectedBlock.style?.btnRadius ?? globalStyle.buttonRadius} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, btnRadius: parseInt(e.target.value) } })} className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer" />
            </div>
          </div>
        </div>
      )}

      {selectedBlock.type === 'dynamic' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Contact field</label>
            <select
              value={selectedBlock.content}
              onChange={(e) => updateBlockContent(selectedBlock.id, { content: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs"
            >
              <option value="contact.FIRSTNAME">contact.FIRSTNAME</option>
              <option value="contact.LASTNAME">contact.LASTNAME</option>
              <option value="contact.EMAIL">contact.EMAIL</option>
              <option value="contact.COMPANY">contact.COMPANY</option>
            </select>
            <p className="text-[10px] text-muted-foreground mt-1">This will render dynamically as a contact attribute tag when sending the newsletter.</p>
          </div>
        </div>
      )}

      {selectedBlock.type === 'html' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Custom HTML Content</label>
            <textarea
              value={selectedBlock.content}
              onChange={(e) => updateBlockContent(selectedBlock.id, { content: e.target.value })}
              className="w-full h-48 px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-accent font-mono text-xs"
            />
          </div>
        </div>
      )}

      {selectedBlock.type === 'divider' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Divider color</label>
            <div className="flex gap-2 items-center">
              <input type="color" value={selectedBlock.style?.dividerColor ?? '#e5e7eb'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, dividerColor: e.target.value } })} className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent flex-shrink-0" />
              <input type="text" value={selectedBlock.style?.dividerColor ?? '#e5e7eb'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, dividerColor: e.target.value } })} className="flex-1 px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono" />
            </div>
          </div>
        </div>
      )}

      {selectedBlock.type === 'spacer' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="font-semibold">Spacer height</span>
              <span className="font-bold text-foreground">{selectedBlock.content || 30}px</span>
            </div>
            <input type="range" min="10" max="150" step="5" value={selectedBlock.content || 30} onChange={(e) => updateBlockContent(selectedBlock.id, { content: e.target.value })} className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer" />
          </div>
        </div>
      )}

      {selectedBlock.type === 'split' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Article Title</label>
            <input
              type="text"
              value={selectedBlock.content}
              onChange={(e) => updateBlockContent(selectedBlock.id, { content: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Body Summary</label>
            <textarea
              value={selectedBlock.subContent || ''}
              onChange={(e) => updateBlockContent(selectedBlock.id, { subContent: e.target.value })}
              className="w-full h-24 px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-xs"
            />
          </div>
          <ImageUrlField
            label="Image URL"
            value={selectedBlock.subImage || ''}
            onChange={(url) => updateBlockContent(selectedBlock.id, { subImage: url })}
          />
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Button URL</label>
            <input
              type="text"
              value={selectedBlock.url || ''}
              onChange={(e) => updateBlockContent(selectedBlock.id, { url: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-xs"
            />
          </div>
        </div>
      )}

      {selectedBlock.type === 'section' && (
        <div className="space-y-4">
          <div className="pt-1 space-y-3">
            <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Container style</span>
            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground font-semibold">Background</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={selectedBlock.style?.bgColor ?? '#ffffff'} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, bgColor: e.target.value } })} className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent flex-shrink-0" />
                <input type="text" value={selectedBlock.style?.bgColor ?? ''} placeholder="none" onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, bgColor: e.target.value || undefined } })} className="flex-1 px-2 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="font-semibold">Padding</span>
                <span className="font-bold text-foreground">{selectedBlock.style?.padding ?? 20}px</span>
              </div>
              <input type="range" min="0" max="60" step="2" value={selectedBlock.style?.padding ?? 20} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, padding: parseInt(e.target.value) } })} className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer" />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="font-semibold">Rounded corners</span>
                <span className="font-bold text-foreground">{selectedBlock.style?.borderRadius ?? 0}px</span>
              </div>
              <input type="range" min="0" max="24" step="1" value={selectedBlock.style?.borderRadius ?? 0} onChange={(e) => updateBlockContent(selectedBlock.id, { style: { ...selectedBlock.style, borderRadius: parseInt(e.target.value) } })} className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer" />
            </div>
          </div>

          <div className="pt-3 border-t border-border/40 space-y-3">
            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Contents ({(selectedBlock.children || []).length})</label>
            {(selectedBlock.children || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No nested blocks — this usually means the imported HTML section was empty or couldn't be parsed.</p>
            )}
            {(selectedBlock.children || []).map((child, index) => {
              const updateChild = (updates: Partial<EmailBlock>) => {
                const newChildren = [...(selectedBlock.children || [])]
                newChildren[index] = { ...child, ...updates }
                updateBlockContent(selectedBlock.id, { children: newChildren })
              }
              const removeChild = () => {
                const newChildren = (selectedBlock.children || []).filter((_, i) => i !== index)
                updateBlockContent(selectedBlock.id, { children: newChildren })
              }
              return (
                <div key={child.id} className="p-3 bg-muted/30 border border-border/60 rounded-xl space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-accent uppercase">{child.type}</span>
                    <button onClick={removeChild} className="text-[10px] text-muted-foreground hover:text-destructive transition-colors">Remove</button>
                  </div>
                  {child.type === 'image' ? (
                    <ImageUrlField
                      value={child.content}
                      onChange={(url) => updateChild({ content: url })}
                      placeholder="Image URL"
                      compact
                    />
                  ) : (
                    <textarea
                      value={child.content}
                      placeholder="Content"
                      onChange={(e) => updateChild({ content: e.target.value })}
                      className="w-full h-14 px-2 py-1 bg-muted border border-border rounded text-xs text-foreground focus:outline-none resize-none"
                    />
                  )}
                  {child.type === 'button' && (
                    <input
                      type="text"
                      value={child.url || ''}
                      placeholder="Button URL"
                      onChange={(e) => updateChild({ url: e.target.value })}
                      className="w-full px-2 py-1 bg-muted border border-border rounded text-[11px] font-mono text-foreground focus:outline-none"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {selectedBlock.type === 'columns' && (
        <ItemListEditor
          label="3-Column Cards"
          items={selectedBlock.items || []}
          onChange={(items) => updateBlockContent(selectedBlock.id, { items })}
        />
      )}

      {selectedBlock.type === 'articles' && (
        <ItemListEditor
          label="Article Cards"
          items={selectedBlock.items || []}
          onChange={(items) => updateBlockContent(selectedBlock.id, { items })}
        />
      )}

      {selectedBlock.type === 'product' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Button label</label>
            <input
              type="text"
              value={selectedBlock.content}
              placeholder="Buy now"
              onChange={(e) => updateBlockContent(selectedBlock.id, { content: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs"
            />
          </div>
          <ItemListEditor
            label="Products"
            items={selectedBlock.items || []}
            onChange={(items) => updateBlockContent(selectedBlock.id, { items })}
            showPrice
          />
        </div>
      )}

      {selectedBlock.type === 'receipt' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Table heading</label>
            <input
              type="text"
              value={selectedBlock.content}
              placeholder="Order summary"
              onChange={(e) => updateBlockContent(selectedBlock.id, { content: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs"
            />
            <p className="text-[10px] text-muted-foreground/70 leading-snug">Leave empty to drop the heading row.</p>
          </div>
          <ItemListEditor
            label="Line items"
            items={selectedBlock.items || []}
            onChange={(items) => updateBlockContent(selectedBlock.id, { items })}
            showQty
            showImage={false}
            showUrl={false}
          />
          <SummaryRowEditor
            rows={selectedBlock.summaryRows || []}
            onChange={(summaryRows) => updateBlockContent(selectedBlock.id, { summaryRows })}
          />
        </div>
      )}

      {selectedBlock.type === 'notice' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Link label</label>
            <input
              type="text"
              value={selectedBlock.content}
              placeholder="Details"
              onChange={(e) => updateBlockContent(selectedBlock.id, { content: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs"
            />
            <p className="text-[10px] text-muted-foreground/70 leading-snug">Shown on every row that has a URL.</p>
          </div>
          <ItemListEditor
            label="Notifications"
            items={selectedBlock.items || []}
            onChange={(items) => updateBlockContent(selectedBlock.id, { items })}
            showBadge
            showImage={false}
          />
        </div>
      )}

      {selectedBlock.type === 'navigation' && (
        <div className="space-y-4">
          <div className="space-y-2">
            {/* Same dual-mode field as the Logo block: plain text renders as a
                wordmark, a URL (pasted or uploaded) renders as an <img> —
                see the isImageLogo sniff in compiler.ts's renderNavigation. */}
            <ImageUrlField
              label="Brand name or logo URL"
              value={selectedBlock.content}
              onChange={(url) => updateBlockContent(selectedBlock.id, { content: url })}
              placeholder="MY BRAND"
            />
            <p className="text-[10px] text-muted-foreground/70 leading-snug">Uploading or pasting an image replaces the text brand name.</p>
          </div>
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Brand link</label>
            <input
              type="text"
              value={selectedBlock.url || ''}
              placeholder="https://example.com"
              onChange={(e) => updateBlockContent(selectedBlock.id, { url: e.target.value })}
              className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono"
            />
          </div>
          <LinkListEditor
            label="Menu links"
            links={selectedBlock.links || []}
            onChange={(links) => updateBlockContent(selectedBlock.id, { links })}
          />
        </div>
      )}

      {selectedBlock.type === 'footer' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground font-semibold">Address / legal text</label>
            <textarea
              value={selectedBlock.content}
              placeholder="Your Company Ltd, 123 Example Street"
              onChange={(e) => updateBlockContent(selectedBlock.id, { content: e.target.value })}
              className="w-full h-20 px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs resize-none"
            />
          </div>
          <LinkListEditor
            label="Footer links"
            links={selectedBlock.links || []}
            onChange={(links) => updateBlockContent(selectedBlock.id, { links })}
          />
          <SocialListEditor
            socials={selectedBlock.socials || []}
            onChange={(socials) => updateBlockContent(selectedBlock.id, { socials })}
          />
        </div>
      )}

      {selectedBlock.type === 'social' && (
        <SocialListEditor
          socials={selectedBlock.socials || []}
          onChange={(socials) => updateBlockContent(selectedBlock.id, { socials })}
        />
      )}

      {['image', 'video', 'logo', 'navigation'].includes(selectedBlock.type) && (
        <AltTextControl block={selectedBlock} update={(updates) => updateBlockContent(selectedBlock.id, updates)} />
      )}

      {selectedBlock.type !== 'spacer' && (
        <div className="pt-2 border-t border-border/50">
          <PaddingControl block={selectedBlock} update={(updates) => updateBlockContent(selectedBlock.id, updates)} />
        </div>
      )}

    </div>
  )
}
