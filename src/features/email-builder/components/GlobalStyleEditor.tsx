import type { GlobalStyle } from '../types'
import { EMAIL_FONT_STACKS } from '../utils/html'
import { Select } from '../../../components/ui/Select'

interface GlobalStyleEditorProps {
  globalStyle: GlobalStyle
  setGlobalStyle: (style: GlobalStyle) => void
}

export function GlobalStyleEditor({ globalStyle, setGlobalStyle }: GlobalStyleEditorProps) {
  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
      
      {/* BRAND LIBRARY MOCK */}
      <div className="space-y-3">
        <span className="text-[10px] font-bold text-muted-foreground/75 uppercase tracking-wider block">Brand library</span>
        <div className="flex gap-2 items-center">
          <div className="p-3 bg-muted border border-border rounded-lg font-extrabold text-xs text-foreground uppercase tracking-tight">
            MY BRAND
          </div>
          <div className="p-3 bg-muted border border-border rounded-lg text-xs font-mono text-muted-foreground">
            sans-serif
          </div>
          <div className="flex gap-1">
            <span className="w-5 h-5 rounded-full border border-border" style={{ backgroundColor: globalStyle.buttonBgColor }} />
            <span className="w-5 h-5 rounded-full border border-border" style={{ backgroundColor: globalStyle.canvasBgColor }} />
          </div>
        </div>
        <button className="w-full py-1.5 border border-border rounded-lg text-xs font-semibold text-foreground hover:bg-muted transition-colors">
          Edit in brand library
        </button>
      </div>

      {/* LAYOUT SETTINGS */}
      <div className="space-y-4">
        <span className="text-[10px] font-bold text-muted-foreground/75 uppercase tracking-wider block">Layout</span>
        
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Body width</span>
            <span className="font-bold text-foreground">{globalStyle.bodyWidth} px</span>
          </div>
          <input 
            type="range" 
            min="400" 
            max="1000" 
            step="50"
            value={globalStyle.bodyWidth}
            onChange={(e) => setGlobalStyle({ ...globalStyle, bodyWidth: parseInt(e.target.value) })}
            className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground font-semibold">Body color</label>
          <div className="flex gap-2 items-center">
            <input 
              type="color" 
              value={globalStyle.bodyBgColor}
              onChange={(e) => setGlobalStyle({ ...globalStyle, bodyBgColor: e.target.value })}
              className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent"
            />
            <input 
              type="text" 
              value={globalStyle.bodyBgColor} 
              onChange={(e) => setGlobalStyle({ ...globalStyle, bodyBgColor: e.target.value })}
              className="flex-1 px-3 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono"
            />
          </div>
        </div>
      </div>

      {/* BACKGROUND CONFIG */}
      <div className="space-y-3">
        <span className="text-[10px] font-bold text-muted-foreground/75 uppercase tracking-wider block">Background</span>
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground font-semibold">Canvas Background Color</label>
          <div className="flex gap-2 items-center">
            <input 
              type="color" 
              value={globalStyle.canvasBgColor}
              onChange={(e) => setGlobalStyle({ ...globalStyle, canvasBgColor: e.target.value })}
              className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent"
            />
            <input 
              type="text" 
              value={globalStyle.canvasBgColor} 
              onChange={(e) => setGlobalStyle({ ...globalStyle, canvasBgColor: e.target.value })}
              className="flex-1 px-3 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono"
            />
          </div>
        </div>
      </div>

      {/* CARD LAYOUT */}
      <div className="space-y-3">
        <span className="text-[10px] font-bold text-muted-foreground/75 uppercase tracking-wider block">Card layout</span>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={globalStyle.cardMode === true}
            onChange={(e) => setGlobalStyle({ ...globalStyle, cardMode: e.target.checked })}
            className="mt-0.5 accent-accent w-3.5 h-3.5 cursor-pointer"
          />
          <span className="text-xs text-muted-foreground leading-snug">
            <span className="font-semibold text-foreground block">Separate cards</span>
            Each block becomes its own panel on the canvas background, instead of one continuous sheet.
          </span>
        </label>

        {globalStyle.cardMode && (
          <div className="space-y-3 pl-6">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Corner radius</span>
                <span className="font-bold text-foreground">{globalStyle.cardRadius ?? 5} px</span>
              </div>
              <input
                type="range" min="0" max="24"
                value={globalStyle.cardRadius ?? 5}
                onChange={(e) => setGlobalStyle({ ...globalStyle, cardRadius: parseInt(e.target.value) })}
                className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Gap between cards</span>
                <span className="font-bold text-foreground">{globalStyle.cardGap ?? 10} px</span>
              </div>
              <input
                type="range" min="0" max="40"
                value={globalStyle.cardGap ?? 10}
                onChange={(e) => setGlobalStyle({ ...globalStyle, cardGap: parseInt(e.target.value) })}
                className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer"
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground font-semibold">Background image URL</label>
          <input
            type="text"
            value={globalStyle.bodyBgImage || ''}
            placeholder="https://... (optional, tiled)"
            onChange={(e) => setGlobalStyle({ ...globalStyle, bodyBgImage: e.target.value })}
            className="w-full px-3 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono"
          />
        </div>
      </div>

      {/* TEXT STYLES */}
      <div className="space-y-4">
        <span className="text-[10px] font-bold text-muted-foreground/75 uppercase tracking-wider block">Text Settings</span>
        
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground font-semibold">Link color</label>
          <div className="flex gap-2 items-center">
            <input 
              type="color" 
              value={globalStyle.linkColor ?? '#2563eb'}
              onChange={(e) => setGlobalStyle({ ...globalStyle, linkColor: e.target.value })}
              className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent"
            />
            <input 
              type="text" 
              value={globalStyle.linkColor ?? '#2563eb'} 
              onChange={(e) => setGlobalStyle({ ...globalStyle, linkColor: e.target.value })}
              className="flex-1 px-3 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground font-semibold">Legal footer line</label>
          <textarea
            value={globalStyle.footerText ?? 'This email was sent to you because you are subscribed to our newsletter.'}
            onChange={(e) => setGlobalStyle({ ...globalStyle, footerText: e.target.value })}
            className="w-full h-16 px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs resize-none"
          />
          <p className="text-[10px] text-muted-foreground/70 leading-snug">
            Appended below every design, with the unsubscribe link. Clear it if you use a Footer block instead.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground font-semibold">Line height</label>
          <Select 
            value={globalStyle.lineHeight} 
            onChange={(e) => setGlobalStyle({ ...globalStyle, lineHeight: parseFloat(e.target.value) })}
            className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs"
          >
            <option value="1.2">Compact (1.2)</option>
            <option value="1.5">Standard (1.5)</option>
            <option value="1.8">Loose (1.8)</option>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground font-semibold font-sans">Font Family</label>
          <Select 
            value={globalStyle.fontFamily}
            onChange={(e) => setGlobalStyle({ ...globalStyle, fontFamily: e.target.value })}
            className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs"
          >
            {EMAIL_FONT_STACKS.map(stack => (
              <option key={stack.value} value={stack.value}>{stack.label}</option>
            ))}
          </Select>
          <p className="text-[10px] text-muted-foreground/70 leading-snug">
            Only fonts installed on the reader's machine render. Every option here ends in a face Outlook and Gmail both have.
          </p>
        </div>
      </div>

      {/* BUTTONS STYLING */}
      <div className="space-y-4">
        <span className="text-[10px] font-bold text-muted-foreground/75 uppercase tracking-wider block">Buttons</span>
        
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground font-semibold">Background color</label>
          <div className="flex gap-2 items-center">
            <input 
              type="color" 
              value={globalStyle.buttonBgColor}
              onChange={(e) => setGlobalStyle({ ...globalStyle, buttonBgColor: e.target.value })}
              className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent"
            />
            <input 
              type="text" 
              value={globalStyle.buttonBgColor} 
              onChange={(e) => setGlobalStyle({ ...globalStyle, buttonBgColor: e.target.value })}
              className="flex-1 px-3 py-1.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none text-xs font-mono"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground font-semibold">Rounded corners</label>
          <div className="flex justify-between text-xs text-muted-foreground items-center">
            <input 
              type="range" 
              min="0" 
              max="24" 
              value={globalStyle.buttonRadius}
              onChange={(e) => setGlobalStyle({ ...globalStyle, buttonRadius: parseInt(e.target.value) })}
              className="flex-1 accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer mr-3"
            />
            <span className="font-bold text-foreground shrink-0 w-8 text-right">{globalStyle.buttonRadius} px</span>
          </div>
        </div>
      </div>

    </div>
  )
}
