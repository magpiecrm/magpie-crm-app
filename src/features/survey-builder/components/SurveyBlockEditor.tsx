import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, Lock, Plus, Trash2 } from 'lucide-react'
import { Switch } from '../../../components/ui/Switch'
import type { LintIssue } from '../logic/lint'
import type { ContactFieldDef } from '../../contacts/contactFields'
import { BUILTIN_FIELD_LABELS } from '../../contacts/contactFields'
import { SurveyImageField } from './SurveyImageField'
import type { ContactFieldMapping, QuestionConfig, QuestionType, SurveyBlock } from '../types'
import { BUILTIN_CONTACT_FIELDS, CHOICE_TYPES, SURVEY_BLOCK_TYPES, isQuestionType } from '../types'
import { compatibleFieldTypes } from '../logic/answers'
import { Select } from '../../../components/ui/Select'

/** The builder panel's own field: the app's field, a little tighter for a 320px column. */
export const inputClass =
  'w-full min-h-9 max-sm:min-h-11 px-2.5 py-1.5 bg-card border border-input rounded-md-s text-[13px] max-sm:text-base text-foreground placeholder:text-muted-foreground/90 transition-[border-color,box-shadow] focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/20 disabled:opacity-60'
/** A field's label: sentence case, the same as every form in the app. */
export const labelClass = 'block text-[13px] font-medium text-foreground'
/** A group of fields: the only uppercase text in the panel. */
export const sectionLabelClass = 'block text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground'
/** A line of help under a field or group. */
export const hintClass = 'text-[13px] leading-relaxed text-muted-foreground text-pretty'

export type Dispatch = (action: string, args: any) => void

/** Question types a question can be switched to without losing its answer shape. */
const SWITCHABLE: QuestionType[][] = [
  ['short_text', 'long_text'],
  ['single_choice', 'multiple_choice', 'dropdown'],
  ['rating', 'scale', 'nps'],
]

interface SurveyBlockEditorProps {
  block: SurveyBlock
  dispatch: Dispatch
  /** The survey has responses and this block existed when it was loaded. */
  locked: boolean
  /** Option ids that can't be deleted because responses may reference them. */
  lockedOptionIds: Set<string>
  contactFields: ContactFieldDef[]
  /** Checks that failed on this block. */
  issues?: LintIssue[]
}

export function SurveyBlockEditor({ block, dispatch, locked, lockedOptionIds, contactFields, issues = [] }: SurveyBlockEditorProps) {
  const update = (updates: Partial<SurveyBlock>) => dispatch('survey.updateBlock', { id: block.id, updates })
  const updateQuestion = (updates: Partial<QuestionConfig>) => update({ question: updates as QuestionConfig })
  const q = block.question

  return (
    <div className="space-y-5">
      {locked && (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground" title="People have answered it, so its type can't change and it can't be deleted. Its wording and options can still change; duplicate the survey to change more.">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Has responses: wording and options only
        </p>
      )}
      {issues.map((issue, i) => (
        <p key={i} className={`flex items-start gap-2 text-[13px] leading-relaxed ${issue.level === 'error' ? 'text-destructive' : 'text-amber-800 dark:text-amber-300'}`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {issue.message}
        </p>
      ))}

      {isQuestionType(block.type) && q ? (
        <>
          <QuestionTypeSwitcher block={block} locked={locked} onChange={type => update({ type })} />

          <div className="space-y-2">
            <label className={labelClass}>Question</label>
            <textarea rows={2} value={q.title} onChange={e => updateQuestion({ title: e.target.value })} className={inputClass} />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>Help text</label>
            <textarea
              rows={2}
              value={q.description ?? ''}
              placeholder="Optional"
              onChange={e => updateQuestion({ description: e.target.value || undefined })}
              className={inputClass}
            />
          </div>
          <Toggle label="Required" hint="People can't go on without answering it." checked={q.required} onChange={required => updateQuestion({ required })} />

          {block.type === 'email' ? (
            <p className={hintClass}>With “Identify contacts” on in Settings, this answer links people who use the public link or an embed to their contact.</p>
          ) : (
            <ContactMappingControl block={block} contactFields={contactFields} onChange={mapTo => updateQuestion({ mapTo })} />
          )}

          {['short_text', 'long_text', 'email', 'number', 'dropdown'].includes(block.type) && (
            <div className="space-y-2">
              <label className={labelClass}>Placeholder</label>
              <input value={q.placeholder ?? ''} onChange={e => updateQuestion({ placeholder: e.target.value || undefined })} className={inputClass} />
            </div>
          )}

          <QuestionTypeFields block={block} dispatch={dispatch} lockedOptionIds={lockedOptionIds} updateQuestion={updateQuestion} />
        </>
      ) : (
        <>
          <ContentFields block={block} update={update} />
          {/* Spacing and a fill are for content blocks; questions take theirs from the survey's style. */}
          {block.type !== 'spacer' && (
            <details className="group rounded-md-s border border-border">
              <summary className="cursor-pointer list-none px-3 py-2.5 text-[13px] font-medium text-foreground marker:hidden">
                <span className="inline-flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                  Spacing and background
                </span>
              </summary>
              <div className="space-y-3 border-t border-border px-3 pb-3 pt-3">
                <SpacingControl block={block} update={update} />
                <ColorField label="Background" value={block.style?.bgColor} onChange={bgColor => update({ style: { bgColor } })} />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}

function QuestionTypeSwitcher({ block, locked, onChange }: { block: SurveyBlock; locked: boolean; onChange: (t: QuestionType) => void }) {
  const group = SWITCHABLE.find(g => g.includes(block.type as QuestionType))
  if (!group || locked) return null
  return (
    <div className="space-y-2">
      <label className={labelClass}>Type</label>
      <div className="flex gap-1 flex-wrap">
        {group.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            aria-pressed={block.type === t}
            className={`min-h-8 cursor-pointer rounded-md-s border px-2.5 text-[13px] font-medium transition-colors ${
              block.type === t ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {SURVEY_BLOCK_TYPES.find(i => i.type === t)?.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function QuestionTypeFields({
  block,
  dispatch,
  lockedOptionIds,
  updateQuestion,
}: {
  block: SurveyBlock
  dispatch: Dispatch
  lockedOptionIds: Set<string>
  updateQuestion: (u: Partial<QuestionConfig>) => void
}) {
  const q = block.question!

  if (CHOICE_TYPES.includes(block.type as QuestionType)) {
    return (
      <div className="space-y-3">
        <OptionListEditor block={block} dispatch={dispatch} lockedOptionIds={lockedOptionIds} />
        {block.type !== 'dropdown' && (
          <Toggle label='Allow "Other" with free text' checked={!!q.allowOther} onChange={allowOther => updateQuestion({ allowOther })} />
        )}
        <Toggle label="Shuffle options" checked={!!q.randomizeOptions} onChange={randomizeOptions => updateQuestion({ randomizeOptions })} />
        {block.type === 'multiple_choice' && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Min picks" value={q.minSelect} onChange={v => updateQuestion({ minSelect: v })} />
            <NumberField label="Max picks" value={q.maxSelect} onChange={v => updateQuestion({ maxSelect: v })} />
          </div>
        )}
      </div>
    )
  }

  switch (block.type) {
    case 'short_text':
    case 'long_text':
      return (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Min length" value={q.minLength} onChange={v => updateQuestion({ minLength: v })} />
          <NumberField label="Max length" value={q.maxLength} onChange={v => updateQuestion({ maxLength: v })} />
        </div>
      )
    case 'number':
      return (
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Min" value={q.min} onChange={v => updateQuestion({ min: v })} />
          <NumberField label="Max" value={q.max} onChange={v => updateQuestion({ max: v })} />
          <NumberField label="Step" value={q.step} onChange={v => updateQuestion({ step: v })} />
        </div>
      )
    case 'rating': {
      const scale = { min: 1, max: 5, icon: 'star' as const, ...q.scale }
      return (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className={labelClass}>Out of</label>
            <Select value={scale.max} onChange={e => updateQuestion({ scale: { ...scale, min: 1, max: Number(e.target.value) } })} className={inputClass}>
              {[3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Icon</label>
            <Select value={scale.icon} onChange={e => updateQuestion({ scale: { ...scale, icon: e.target.value as 'star' } })} className={inputClass}>
              <option value="star">Stars</option>
              <option value="heart">Hearts</option>
              <option value="number">Numbers</option>
            </Select>
          </div>
        </div>
      )
    }
    case 'scale':
    case 'nps': {
      const scale = block.type === 'nps' ? { min: 0, max: 10, ...q.scale } : { min: 1, max: 7, ...q.scale }
      return (
        <div className="space-y-2">
          {block.type === 'scale' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className={labelClass}>From</label>
                <Select value={scale.min} onChange={e => updateQuestion({ scale: { ...scale, min: Number(e.target.value) } })} className={inputClass}>
                  <option value={0}>0</option>
                  <option value={1}>1</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className={labelClass}>To</label>
                <Select value={scale.max} onChange={e => updateQuestion({ scale: { ...scale, max: Number(e.target.value) } })} className={inputClass}>
                  {[3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelClass}>Low label</label>
              <input value={scale.minLabel ?? ''} onChange={e => updateQuestion({ scale: { ...scale, minLabel: e.target.value || undefined } })} className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>High label</label>
              <input value={scale.maxLabel ?? ''} onChange={e => updateQuestion({ scale: { ...scale, maxLabel: e.target.value || undefined } })} className={inputClass} />
            </div>
          </div>
        </div>
      )
    }
    default:
      return null
  }
}

const iconButton =
  'inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md-s text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent'

function OptionListEditor({ block, dispatch, lockedOptionIds }: { block: SurveyBlock; dispatch: Dispatch; lockedOptionIds: Set<string> }) {
  const options = block.question?.options ?? []
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className={labelClass}>Options</label>
        <button
          type="button"
          onClick={() => dispatch('survey.addOption', { blockId: block.id, option: { label: `Option ${options.length + 1}` } })}
          className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md-s px-2 text-[13px] font-medium text-accent hover:bg-accent/10"
        >
          <Plus className="h-3.5 w-3.5" /> Add option
        </button>
      </div>
      {options.map((option, i) => (
        <div key={option.id} className="flex items-center gap-0.5">
          <input
            value={option.label}
            onChange={e => dispatch('survey.updateOption', { blockId: block.id, optionId: option.id, updates: { label: e.target.value } })}
            className={inputClass}
          />
          <button
            type="button"
            disabled={i === 0}
            onClick={() => dispatch('survey.moveOption', { blockId: block.id, optionId: option.id, direction: 'up' })}
            className={iconButton}
            aria-label={`Move “${option.label}” up`}
            title="Move up"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={i === options.length - 1}
            onClick={() => dispatch('survey.moveOption', { blockId: block.id, optionId: option.id, direction: 'down' })}
            className={iconButton}
            aria-label={`Move “${option.label}” down`}
            title="Move down"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={lockedOptionIds.has(option.id)}
            title={lockedOptionIds.has(option.id) ? 'People have picked it, so it stays' : 'Delete'}
            onClick={() => dispatch('survey.deleteOption', { blockId: block.id, optionId: option.id })}
            className={`${iconButton} hover:!text-destructive`}
            aria-label={`Delete “${option.label}”`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

function ContactMappingControl({
  block,
  contactFields,
  onChange,
}: {
  block: SurveyBlock
  contactFields: ContactFieldDef[]
  onChange: (mapTo: ContactFieldMapping | undefined) => void
}) {
  const mapTo = block.question?.mapTo
  const compatible = compatibleFieldTypes(block)
  const textOk = compatible.includes('text')
  const customFields = contactFields.filter(f => compatible.includes(f.type))

  return (
    <div className="space-y-2">
      <span className={labelClass}>Save the answer to their contact</span>
      <Select
        value={mapTo?.field ?? ''}
        onChange={e => onChange(e.target.value ? { field: e.target.value as ContactFieldMapping['field'], overwrite: mapTo?.overwrite ?? 'if_empty' } : undefined)}
        className={inputClass}
      >
        <option value="">Don't save it</option>
        {textOk && (
          <optgroup label="Contact fields">
            {BUILTIN_CONTACT_FIELDS.map(f => (
              <option key={f} value={f}>
                {BUILTIN_FIELD_LABELS[f]}
              </option>
            ))}
          </optgroup>
        )}
        {customFields.length > 0 && (
          <optgroup label="Custom fields">
            {customFields.map(f => (
              <option key={f.key} value={`custom:${f.key}`}>
                {f.label}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      {mapTo && (
        <Select
          value={mapTo.overwrite}
          onChange={e => onChange({ ...mapTo, overwrite: e.target.value as ContactFieldMapping['overwrite'] })}
          className={inputClass}
        >
          <option value="if_empty">Only if the contact's field is empty</option>
          <option value="always">Always overwrite with the latest answer</option>
        </Select>
      )}
      <p className={hintClass}>{mapTo ? 'Written to the contact as they answer.' : 'Add your own fields in Settings → Contact fields.'}</p>
    </div>
  )
}

function ContentFields({ block, update }: { block: SurveyBlock; update: (u: Partial<SurveyBlock>) => void }) {
  switch (block.type) {
    case 'heading':
    case 'text':
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className={labelClass}>Text</label>
            <textarea rows={block.type === 'text' ? 5 : 2} value={block.content ?? ''} onChange={e => update({ content: e.target.value })} className={inputClass} />
          </div>
          <AlignField value={block.style?.textAlign ?? block.align} onChange={textAlign => update({ style: { textAlign } })} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Font size" value={block.style?.fontSize} onChange={fontSize => update({ style: { fontSize } })} />
            <div className="space-y-1">
              <label className={labelClass}>Weight</label>
              <Select
                value={block.style?.fontWeight ?? (block.type === 'heading' ? 'bold' : 'normal')}
                onChange={e => update({ style: { fontWeight: e.target.value as 'bold' } })}
                className={inputClass}
              >
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
              </Select>
            </div>
          </div>
          <ColorField label="Text colour" value={block.style?.color} onChange={color => update({ style: { color } })} />
        </div>
      )
    case 'image':
      return (
        <div className="space-y-4">
          <SurveyImageField label="Image" value={block.content ?? ''} onChange={content => update({ content })} />
          <div className="space-y-1.5">
            <label className={labelClass}>Description</label>
            <input value={block.alt ?? ''} placeholder="What the image shows" onChange={e => update({ alt: e.target.value || undefined })} className={inputClass} />
            <p className={hintClass}>Read out by screen readers, and shown if the image can't load.</p>
          </div>
          <div className="space-y-2">
            <label className={labelClass}>Link (optional)</label>
            <input value={block.url ?? ''} onChange={e => update({ url: e.target.value || undefined })} className={inputClass} placeholder="https://" />
          </div>
          <div className="space-y-2">
            <label className={labelClass}>Width</label>
            <Select value={block.width ?? '100%'} onChange={e => update({ width: e.target.value })} className={inputClass}>
              {['25%', '50%', '75%', '100%'].map(w => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </Select>
          </div>
          <AlignField value={block.align} onChange={align => update({ align })} />
        </div>
      )
    case 'divider':
      return <ColorField label="Line colour" value={block.style?.color} onChange={color => update({ style: { color } })} />
    case 'spacer':
      return <NumberField label="Height (px)" value={block.style?.height ?? 24} onChange={height => update({ style: { height } })} />
    case 'html':
      return (
        <div className="space-y-2">
          <label className={labelClass}>HTML</label>
          <textarea rows={8} value={block.content ?? ''} onChange={e => update({ content: e.target.value })} className={`${inputClass} font-mono`} />
        </div>
      )
    default:
      return null
  }
}

/** An on/off setting: its label (and a line of help) on the left, a switch on the right. */
export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 cursor-pointer" onClick={() => onChange(!checked)}>
        <span className="block text-[13px] font-medium text-foreground">{label}</span>
        {hint && <span className={`mt-0.5 block ${hintClass}`}>{hint}</span>}
      </div>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  )
}

export function NumberField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      <input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className={inputClass}
      />
    </div>
  )
}

export function ColorField({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      <div className="flex gap-2 items-center">
        <input type="color" value={value ?? '#ffffff'} onChange={e => onChange(e.target.value)} aria-label={`${label}: pick a colour`} className="h-9 w-9 shrink-0 cursor-pointer rounded-md-s border border-input bg-transparent p-0.5" />
        <input value={value ?? ''} placeholder="Default" onChange={e => onChange(e.target.value || undefined)} className={`${inputClass} font-mono`} />
      </div>
    </div>
  )
}

function AlignField({ value, onChange }: { value: 'left' | 'center' | 'right' | undefined; onChange: (v: 'left' | 'center' | 'right') => void }) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>Alignment</label>
      <div className="flex gap-1">
        {(['left', 'center', 'right'] as const).map(a => (
          <button
            key={a}
            type="button"
            onClick={() => onChange(a)}
            aria-pressed={(value ?? 'left') === a}
            className={`min-h-8 flex-1 cursor-pointer rounded-md-s border text-[13px] font-medium capitalize transition-colors ${
              (value ?? 'left') === a ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Space around a content block, in pixels, side by side. */
function SpacingControl({ block, update }: { block: SurveyBlock; update: (u: Partial<SurveyBlock>) => void }) {
  const st = block.style ?? {}
  const sides = [
    ['paddingTop', 'Top', 8],
    ['paddingBottom', 'Bottom', 8],
    ['paddingLeft', 'Left', 0],
    ['paddingRight', 'Right', 0],
  ] as const
  return (
    <div className="space-y-1.5">
      <span className={labelClass}>Space around it (px)</span>
      <div className="grid grid-cols-4 gap-1.5">
        {sides.map(([key, label, fallback]) => (
          <label key={key} className="space-y-1">
            <span className="block text-center text-xs text-muted-foreground">{label}</span>
            <input
              type="number"
              min={0}
              value={st[key] ?? st.padding ?? fallback}
              onChange={e => update({ style: { [key]: e.target.value === '' ? undefined : Number(e.target.value) } })}
              className={`${inputClass} text-center tabular-nums`}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
