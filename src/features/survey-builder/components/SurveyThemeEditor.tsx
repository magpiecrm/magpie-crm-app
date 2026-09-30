import type { SurveyTheme } from '../types'
import { EMAIL_FONT_STACKS } from '../../email-builder/utils/html'
import { ImageUrlField } from '../../email-builder/components/ImageUrlField'
import { ColorField, NumberField, Toggle, inputClass, labelClass, sectionLabelClass } from './SurveyBlockEditor'
import { Select } from '../../../components/ui/Select'

interface SurveyThemeEditorProps {
  theme: SurveyTheme
  setTheme: (updates: Partial<SurveyTheme>) => void
}

/** The survey's equivalent of the email builder's `GlobalStyleEditor`. */
export function SurveyThemeEditor({ theme, setTheme }: SurveyThemeEditorProps) {
  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
      <div className="space-y-3">
        <span className={sectionLabelClass}>Brand</span>
        <ImageUrlField label="Logo" value={theme.logoUrl ?? ''} onChange={logoUrl => setTheme({ logoUrl: logoUrl || undefined })} />
        <ColorField label="Accent (buttons, selection)" value={theme.accentColor} onChange={v => setTheme({ accentColor: v ?? '#27272a' })} />
        <ColorField label="Button text" value={theme.buttonTextColor} onChange={v => setTheme({ buttonTextColor: v ?? '#ffffff' })} />
        <ColorField label="Text" value={theme.textColor} onChange={v => setTheme({ textColor: v ?? '#18181b' })} />
      </div>

      <div className="space-y-3">
        <span className={sectionLabelClass}>Layout</span>
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Card width</span>
            <span className="font-bold text-foreground">{theme.bodyWidth} px</span>
          </div>
          <input
            type="range"
            min="400"
            max="1000"
            step="20"
            value={theme.bodyWidth}
            onChange={e => setTheme({ bodyWidth: parseInt(e.target.value) })}
            className="w-full accent-accent bg-muted h-1 rounded-lg outline-none cursor-pointer"
          />
        </div>
        <ColorField label="Page background" value={theme.pageBgColor} onChange={v => setTheme({ pageBgColor: v ?? '#f4f4f5' })} />
        <ColorField label="Card background" value={theme.cardBgColor} onChange={v => setTheme({ cardBgColor: v ?? '#ffffff' })} />
        <ImageUrlField label="Background image" value={theme.bgImage ?? ''} onChange={bgImage => setTheme({ bgImage: bgImage || undefined })} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Card radius" value={theme.cardRadius} onChange={v => setTheme({ cardRadius: v })} />
          <NumberField label="Button radius" value={theme.buttonRadius} onChange={v => setTheme({ buttonRadius: v ?? 0 })} />
        </div>
        <Toggle label="Each block as its own card" checked={!!theme.cardMode} onChange={cardMode => setTheme({ cardMode })} />
        <Toggle label="Progress bar" checked={theme.showProgressBar} onChange={showProgressBar => setTheme({ showProgressBar })} />
      </div>

      <div className="space-y-3">
        <span className={sectionLabelClass}>Typography</span>
        <div className="space-y-1">
          <label className={labelClass}>Font</label>
          <Select value={theme.fontFamily} onChange={e => setTheme({ fontFamily: e.target.value })} className={inputClass}>
            {!EMAIL_FONT_STACKS.some(f => f.value === theme.fontFamily) && <option value={theme.fontFamily}>{theme.fontFamily}</option>}
            {EMAIL_FONT_STACKS.map(f => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <NumberField label="Line height" value={theme.lineHeight} onChange={v => setTheme({ lineHeight: v ?? 1.5 })} />
      </div>

      <div className="space-y-3">
        <span className={sectionLabelClass}>Button labels</span>
        <div className="grid grid-cols-3 gap-2">
          {(['backLabel', 'nextLabel', 'submitLabel'] as const).map(key => (
            <div key={key} className="space-y-1">
              <label className={labelClass}>{key.replace('Label', '')}</label>
              <input value={theme[key]} onChange={e => setTheme({ [key]: e.target.value })} className={inputClass} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
