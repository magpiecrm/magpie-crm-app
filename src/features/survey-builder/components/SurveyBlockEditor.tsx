import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from 'lucide-react'
import type { ContactFieldDef } from '../../contacts/contactFields'
import { BUILTIN_FIELD_LABELS } from '../../contacts/contactFields'
import { AltTextControl, PaddingControl } from '../../email-builder/components/BlockEditorControls'
import { ImageUrlField } from '../../email-builder/components/ImageUrlField'
import type { ContactFieldMapping, QuestionConfig, QuestionType, SurveyBlock } from '../types'
import { BUILTIN_CONTACT_FIELDS, CHOICE_TYPES, SURVEY_BLOCK_TYPES, isQuestionType } from '../types'
import { compatibleFieldTypes } from '../logic/answers'
import { Select } from '../../../components/ui/Select'

export const inputClass =
  'w-full px-2 py-1.5 bg-muted border border-border rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent'
export const labelClass = 'block text-[10px] text-muted-foreground font-semibold uppercase tracking-wider'
export const sectionLabelClass =
  'block text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/50 pb-1.5'

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
}

export function SurveyBlockEditor({ block, dispatch, locked, lockedOptionIds, contactFields }: SurveyBlockEditorProps) {
  const update = (updates: Partial<SurveyBlock>) => dispatch('survey.updateBlock', { id: block.id, updates })
  const updateQuestion = (updates: Partial<QuestionConfig>) => update({ question: updates as QuestionConfig })
  const info = SURVEY_BLOCK_TYPES.find(t => t.type === block.type)
  const q = block.question

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-foreground">{info?.label}</span>
        {locked && (
          <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400" title="This question has responses">
            <Lock className="w-3 h-3" /> Has responses
          </span>
        )}
      </div>

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
          <Toggle label="Required" checked={q.required} onChange={required => updateQuestion({ required })} />

          {['short_text', 'long_text', 'email', 'number', 'dropdown'].includes(block.type) && (
            <div className="space-y-2">
              <label className={labelClass}>Placeholder</label>
              <input value={q.placeholder ?? ''} onChange={e => updateQuestion({ placeholder: e.target.value || undefined })} className={inputClass} />
            </div>
          )}

          <QuestionTypeFields block={block} dispatch={dispatch} lockedOptionIds={lockedOptionIds} updateQuestion={updateQuestion} />

          {block.type === 'email' ? (
            <p className="text-[10px] text-muted-foreground leading-snug">
              When "Identify contacts" is on in Settings, this answer links anonymous respondents to their contact profile.
            </p>
          ) : (
            <ContactMappingControl block={block} contactFields={contactFields} onChange={mapTo => updateQuestion({ mapTo })} />
          )}
        </>
      ) : (
        <ContentFields block={block} update={update} />
      )}

      <div className="space-y-3 pt-2">
        <span className={sectionLabelClass}>Layout</span>
        <PaddingControl block={block} update={update} defaults={[8, 0, 8, 0]} />
        <ColorField label="Background" value={block.style?.bgColor} onChange={bgColor => update({ style: { bgColor } })} />
      </div>
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
            className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
              block.type === t ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground hover:text-foreground'
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

function OptionListEditor({ block, dispatch, lockedOptionIds }: { block: SurveyBlock; dispatch: Dispatch; lockedOptionIds: Set<string> }) {
  const options = block.question?.options ?? []
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className={labelClass}>Options</label>
        <button
          type="button"
          onClick={() => dispatch('survey.addOption', { blockId: block.id, option: { label: `Option ${options.length + 1}` } })}
          className="flex items-center gap-1 text-[10px] text-accent hover:underline font-semibold"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {options.map((option, i) => (
        <div key={option.id} className="flex gap-1 items-center">
          <input
            value={option.label}
            onChange={e => dispatch('survey.updateOption', { blockId: block.id, optionId: option.id, updates: { label: e.target.value } })}
            className={inputClass}
          />
          <button
            type="button"
            disabled={i === 0}
            onClick={() => dispatch('survey.moveOption', { blockId: block.id, optionId: option.id, direction: 'up' })}
            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Move up"
          >
            <ArrowUp className="w-3 h-3" />
          </button>
          <button
            type="button"
            disabled={i === options.length - 1}
            onClick={() => dispatch('survey.moveOption', { blockId: block.id, optionId: option.id, direction: 'down' })}
            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Move down"
          >
            <ArrowDown className="w-3 h-3" />
          </button>
          <button
            type="button"
            disabled={lockedOptionIds.has(option.id)}
            title={lockedOptionIds.has(option.id) ? 'This option has responses' : 'Delete'}
            onClick={() => dispatch('survey.deleteOption', { blockId: block.id, optionId: option.id })}
            className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
            aria-label="Delete option"
          >
            <Trash2 className="w-3 h-3" />
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
    <div className="space-y-2 pt-2">
      <span className={sectionLabelClass}>Save to contact</span>
      <Select
        value={mapTo?.field ?? ''}
        onChange={e => onChange(e.target.value ? { field: e.target.value as ContactFieldMapping['field'], overwrite: mapTo?.overwrite ?? 'if_empty' } : undefined)}
        className={inputClass}
      >
        <option value="">Don't save to the contact</option>
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
      <p className="text-[10px] text-muted-foreground leading-snug">
        Answers are written to the respondent's profile. Add custom fields in Settings → Contact fields.
      </p>
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
          <ImageUrlField label="Image" value={block.content ?? ''} onChange={content => update({ content })} showPreview />
          <AltTextControl block={block} update={update} />
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

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-foreground cursor-pointer">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-accent w-4 h-4 cursor-pointer" />
    </label>
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
        <input type="color" value={value ?? '#ffffff'} onChange={e => onChange(e.target.value)} className="w-8 h-8 border border-border rounded cursor-pointer bg-transparent" />
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
            className={`flex-1 py-1 rounded-lg text-[11px] font-semibold border capitalize ${
              (value ?? 'left') === a ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground'
            }`}
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  )
}
