import { AlertTriangle } from 'lucide-react'
import type { SurveyTheme } from '../types'
import { SurveyImageField } from './SurveyImageField'
import { ColorField, NumberField, Toggle, hintClass, inputClass, labelClass, sectionLabelClass } from './SurveyBlockEditor'
import { Select } from '../../../components/ui/Select'
import { contrastRatio } from '../runtime/questions'

/** Fonts a survey page can use: the visitor's own system font, then the usual safe stacks, by name. */
const SURVEY_FONTS = [
  { label: 'System font', value: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Arial', value: "Arial, 'Helvetica Neue', Helvetica, sans-serif" },
  { label: 'Verdana', value: 'Verdana, Geneva, Tahoma, sans-serif' },
  { label: 'Trebuchet', value: "'Trebuchet MS', Tahoma, Arial, sans-serif" },
  { label: 'Georgia (serif)', value: "Georgia, 'Times New Roman', Times, serif" },
  { label: 'Times (serif)', value: "'Times New Roman', Times, Georgia, serif" },
] as const

/** Ready-made looks: colours that work together, each button text at 4.5:1 or better on its button. */
const LOOKS: Array<{ name: string; theme: Pick<SurveyTheme, 'accentColor' | 'buttonTextColor' | 'pageBgColor' | 'cardBgColor' | 'textColor'> }> = [
  { name: 'Plain', theme: { accentColor: '#27272a', buttonTextColor: '#ffffff', pageBgColor: '#f4f4f5', cardBgColor: '#ffffff', textColor: '#18181b' } },
  { name: 'Teal', theme: { accentColor: '#0f766e', buttonTextColor: '#ffffff', pageBgColor: '#eef6f5', cardBgColor: '#ffffff', textColor: '#13201f' } },
  { name: 'Indigo', theme: { accentColor: '#4f46e5', buttonTextColor: '#ffffff', pageBgColor: '#f1f1fb', cardBgColor: '#ffffff', textColor: '#1b1b2f' } },
  { name: 'Amber', theme: { accentColor: '#b45309', buttonTextColor: '#ffffff', pageBgColor: '#faf6f0', cardBgColor: '#ffffff', textColor: '#2b2118' } },
  { name: 'Rose', theme: { accentColor: '#be123c', buttonTextColor: '#ffffff', pageBgColor: '#fbf1f3', cardBgColor: '#ffffff', textColor: '#2a1419' } },
  { name: 'Night', theme: { accentColor: '#22d3ee', buttonTextColor: '#0f172a', pageBgColor: '#0f172a', cardBgColor: '#1e293b', textColor: '#e2e8f0' } },
]

interface SurveyThemeEditorProps {
  theme: SurveyTheme
  setTheme: (updates: Partial<SurveyTheme>) => void
}

/** The survey's equivalent of the email builder's `GlobalStyleEditor`. */
export function SurveyThemeEditor({ theme, setTheme }: SurveyThemeEditorProps) {
  const buttonContrast = contrastRatio(theme.buttonTextColor, theme.accentColor)
  const known = SURVEY_FONTS.some(f => f.value === theme.fontFamily)
  return (
    <div className="flex-1 space-y-7 overflow-y-auto p-5 custom-scrollbar">
      <section className="space-y-3">
        <h3 className={sectionLabelClass}>Looks</h3>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Ready-made looks">
          {LOOKS.map(look => {
            const on = (Object.keys(look.theme) as Array<keyof typeof look.theme>).every(k => theme[k].toLowerCase() === look.theme[k])
            return (
              <button
                key={look.name}
                type="button"
                aria-pressed={on}
                onClick={() => setTheme(look.theme)}
                className={`flex cursor-pointer flex-col items-stretch gap-1.5 rounded-md-s border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${on ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-foreground/30'}`}
              >
                <span aria-hidden className="flex h-9 items-center justify-center gap-1 rounded-[5px]" style={{ background: look.theme.pageBgColor }}>
                  <span className="h-5 w-8 rounded-[3px]" style={{ background: look.theme.cardBgColor, boxShadow: '0 0 0 1px rgba(0,0,0,.06)' }} />
                  <span className="h-5 w-5 rounded-[3px]" style={{ background: look.theme.accentColor }} />
                </span>
                <span className="px-0.5 text-xs font-medium text-foreground">{look.name}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className={sectionLabelClass}>Brand</h3>
        <SurveyImageField label="Logo" hint="Shown at the top of the first page and the thank-you." value={theme.logoUrl ?? ''} onChange={logoUrl => setTheme({ logoUrl: logoUrl || undefined })} />
        <ColorField label="Buttons and choices" value={theme.accentColor} onChange={v => setTheme({ accentColor: v ?? '#27272a' })} />
        <ColorField label="Button text" value={theme.buttonTextColor} onChange={v => setTheme({ buttonTextColor: v ?? '#ffffff' })} />
        {buttonContrast !== null && buttonContrast < 4.5 && (
          <p className="flex items-start gap-2 rounded-md-s border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2.5 text-[13px] leading-relaxed text-foreground dark:bg-amber-500/10">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span>
              Button text is hard to read on that colour ({buttonContrast.toFixed(1)}:1; aim for 4.5:1). Try a darker button colour, or {contrastRatio('#ffffff', theme.accentColor)! > contrastRatio('#111111', theme.accentColor)! ? 'white' : 'black'} text.
            </span>
          </p>
        )}
        <ColorField label="Text" value={theme.textColor} onChange={v => setTheme({ textColor: v ?? '#18181b' })} />
      </section>

      <section className="space-y-4">
        <h3 className={sectionLabelClass}>Page</h3>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <label className={labelClass} htmlFor="survey-card-width">
              Width
            </label>
            <span className="text-[13px] tabular-nums text-muted-foreground">{theme.bodyWidth}px</span>
          </div>
          <input
            id="survey-card-width"
            type="range"
            min="400"
            max="1000"
            step="20"
            value={theme.bodyWidth}
            onChange={e => setTheme({ bodyWidth: parseInt(e.target.value) })}
            className="h-1 w-full cursor-pointer rounded-lg bg-muted accent-accent outline-none"
          />
        </div>
        <ColorField label="Background" value={theme.pageBgColor} onChange={v => setTheme({ pageBgColor: v ?? '#f4f4f5' })} />
        <ColorField label="Card" value={theme.cardBgColor} onChange={v => setTheme({ cardBgColor: v ?? '#ffffff' })} />
        <SurveyImageField label="Background image" value={theme.bgImage ?? ''} onChange={bgImage => setTheme({ bgImage: bgImage || undefined })} />
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Card corners" value={theme.cardRadius} onChange={v => setTheme({ cardRadius: v })} />
          <NumberField label="Button corners" value={theme.buttonRadius} onChange={v => setTheme({ buttonRadius: v ?? 0 })} />
        </div>
        <Toggle label="A card for each question" checked={!!theme.cardMode} onChange={cardMode => setTheme({ cardMode })} />
        <Toggle label="Progress bar" hint="On surveys with more than one page." checked={theme.showProgressBar} onChange={showProgressBar => setTheme({ showProgressBar })} />
      </section>

      <section className="space-y-4">
        <h3 className={sectionLabelClass}>Text</h3>
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="survey-font">
            Font
          </label>
          <Select id="survey-font" value={theme.fontFamily} onChange={e => setTheme({ fontFamily: e.target.value })} className={inputClass}>
            {!known && <option value={theme.fontFamily}>{theme.fontFamily.split(',')[0].replace(/['"]/g, '')}</option>}
            {SURVEY_FONTS.map(f => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          <p className={hintClass} style={{ fontFamily: theme.fontFamily }}>
            How likely are you to recommend us?
          </p>
        </div>
        <NumberField label="Line height" value={theme.lineHeight} onChange={v => setTheme({ lineHeight: v ?? 1.5 })} />
      </section>

      <section className="space-y-4">
        <h3 className={sectionLabelClass}>Buttons</h3>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['backLabel', 'Back'],
              ['nextLabel', 'Next page'],
              ['submitLabel', 'Last page'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <label className={labelClass} htmlFor={`survey-${key}`}>
                {label}
              </label>
              <input id={`survey-${key}`} value={theme[key]} onChange={e => setTheme({ [key]: e.target.value })} className={inputClass} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
