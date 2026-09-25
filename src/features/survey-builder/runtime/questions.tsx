import type React from 'react'
import { useMemo } from 'react'
import type { AnswerValue, ChoiceAnswer, SurveyBlock, SurveyTheme } from '../types'
import { scaleRange } from '../logic/validate'

/**
 * Question inputs, styled inline from the survey theme (not Tailwind) so they
 * look identical on the builder canvas, the hosted page and inside an embed
 * iframe on a third-party site.
 */

export interface QuestionInputProps {
  block: SurveyBlock
  theme: SurveyTheme
  value: AnswerValue | undefined
  onChange: (value: AnswerValue) => void
  disabled?: boolean
}

function inputStyle(theme: SurveyTheme): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    fontSize: 15,
    fontFamily: theme.fontFamily,
    color: theme.textColor,
    background: theme.cardBgColor,
    border: `1px solid ${mix(theme.textColor, 0.2)}`,
    borderRadius: Math.min(theme.buttonRadius, 12),
    outline: 'none',
  }
}

/** A translucent version of a hex colour, for borders and hover fills. */
export function mix(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(0,0,0,${alpha})`
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function pillStyle(theme: SurveyTheme, selected: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 14px',
    fontSize: 15,
    fontFamily: theme.fontFamily,
    textAlign: 'left',
    cursor: 'pointer',
    color: selected ? theme.buttonTextColor : theme.textColor,
    background: selected ? theme.accentColor : theme.cardBgColor,
    border: `1px solid ${selected ? theme.accentColor : mix(theme.textColor, 0.2)}`,
    borderRadius: Math.min(theme.buttonRadius, 12),
  }
}

function asChoice(value: AnswerValue | undefined): ChoiceAnswer {
  return value && typeof value === 'object' ? value : { optionIds: [] }
}

/** Stable per-mount shuffle, so options don't jump around on every keystroke. */
function useOrderedOptions(block: SurveyBlock) {
  const options = block.question?.options ?? []
  const randomize = block.question?.randomizeOptions
  const idKey = options.map(o => o.id).join('|')
  // Only the order is memoised, keyed on the ids, so label edits still show.
  const order = useMemo(() => {
    const ids = idKey ? idKey.split('|') : []
    if (!randomize) return ids
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
    }
    return ids
  }, [randomize, idKey])
  return order.map(id => options.find(o => o.id === id)!).filter(Boolean)
}

function ChoiceInput({ block, theme, value, onChange, disabled }: QuestionInputProps) {
  const q = block.question!
  const multi = block.type === 'multiple_choice'
  const current = asChoice(value)
  const options = useOrderedOptions(block)
  const otherSelected = current.other !== undefined

  const toggle = (id: string) => {
    if (multi) {
      const has = current.optionIds.includes(id)
      onChange({ ...current, optionIds: has ? current.optionIds.filter(x => x !== id) : [...current.optionIds, id] })
    } else {
      onChange({ optionIds: [id] })
    }
  }

  const toggleOther = () => {
    if (multi) {
      const { other, ...rest } = current
      onChange(otherSelected ? rest : { ...current, other: '' })
    } else {
      onChange(otherSelected ? { optionIds: [] } : { optionIds: [], other: '' })
    }
  }

  return (
    <div role={multi ? 'group' : 'radiogroup'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {options.map(o => {
        const selected = current.optionIds.includes(o.id)
        return (
          <button
            type="button"
            key={o.id}
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={selected}
            disabled={disabled}
            onClick={() => toggle(o.id)}
            style={pillStyle(theme, selected)}
          >
            <Marker theme={theme} selected={selected} square={multi} />
            {o.label || <em style={{ opacity: 0.5 }}>Untitled option</em>}
          </button>
        )
      })}
      {q.allowOther && (
        <>
          <button
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={otherSelected}
            disabled={disabled}
            onClick={toggleOther}
            style={pillStyle(theme, otherSelected)}
          >
            <Marker theme={theme} selected={otherSelected} square={multi} />
            Other
          </button>
          {otherSelected && (
            <input
              autoFocus
              disabled={disabled}
              value={current.other ?? ''}
              onChange={e => onChange({ ...current, other: e.target.value })}
              placeholder="Please specify"
              style={inputStyle(theme)}
            />
          )}
        </>
      )}
    </div>
  )
}

function Marker({ theme, selected, square }: { theme: SurveyTheme; selected: boolean; square: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 16,
        height: 16,
        flexShrink: 0,
        borderRadius: square ? 4 : 999,
        border: `2px solid ${selected ? theme.buttonTextColor : mix(theme.textColor, 0.35)}`,
        background: selected ? theme.buttonTextColor : 'transparent',
        boxShadow: selected ? `inset 0 0 0 2px ${theme.accentColor}` : undefined,
      }}
    />
  )
}

function ScaleInput({ block, theme, value, onChange, disabled }: QuestionInputProps) {
  const { min, max } = scaleRange(block)
  const scale = block.question?.scale
  const icon = block.type === 'rating' ? scale?.icon ?? 'star' : 'number'
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const current = typeof value === 'number' ? value : null

  if (icon !== 'number') {
    const glyph = icon === 'heart' ? '♥' : '★'
    return (
      <div role="radiogroup" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {values.map(n => (
          <button
            type="button"
            key={n}
            role="radio"
            aria-checked={current === n}
            aria-label={`${n} of ${max}`}
            disabled={disabled}
            onClick={() => onChange(n)}
            style={{
              fontSize: 32,
              lineHeight: 1,
              padding: 2,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: current !== null && n <= current ? theme.accentColor : mix(theme.textColor, 0.2),
            }}
          >
            {glyph}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div role="radiogroup" style={{ display: 'grid', gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))`, gap: 4 }}>
        {values.map(n => {
          const selected = current === n
          return (
            <button
              type="button"
              key={n}
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(n)}
              style={{ ...pillStyle(theme, selected), justifyContent: 'center', padding: '10px 0', fontWeight: 600 }}
            >
              {n}
            </button>
          )
        })}
      </div>
      {(scale?.minLabel || scale?.maxLabel) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          <span>{scale?.minLabel}</span>
          <span>{scale?.maxLabel}</span>
        </div>
      )}
    </div>
  )
}

export function QuestionInput(props: QuestionInputProps) {
  const { block, theme, value, onChange, disabled } = props
  const q = block.question!

  switch (block.type) {
    case 'short_text':
    case 'email':
    case 'number':
    case 'date':
      return (
        <input
          type={block.type === 'short_text' ? 'text' : block.type}
          inputMode={block.type === 'number' ? 'decimal' : undefined}
          disabled={disabled}
          placeholder={q.placeholder}
          min={q.min}
          max={q.max}
          step={q.step}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={e => {
            const raw = e.target.value
            if (block.type === 'number') onChange(raw === '' ? null : Number(raw))
            else onChange(raw)
          }}
          style={inputStyle(theme)}
        />
      )
    case 'long_text':
      return (
        <textarea
          disabled={disabled}
          placeholder={q.placeholder}
          rows={4}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onChange(e.target.value)}
          style={{ ...inputStyle(theme), resize: 'vertical' }}
        />
      )
    case 'dropdown': {
      const current = asChoice(value).optionIds[0] ?? ''
      return (
        <select
          disabled={disabled}
          value={current}
          onChange={e => onChange(e.target.value ? { optionIds: [e.target.value] } : null)}
          style={inputStyle(theme)}
        >
          <option value="">{q.placeholder || 'Select…'}</option>
          {(q.options ?? []).map(o => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )
    }
    case 'single_choice':
    case 'multiple_choice':
      return <ChoiceInput {...props} />
    case 'rating':
    case 'nps':
    case 'scale':
      return <ScaleInput {...props} />
    case 'yes_no':
      return (
        <div role="radiogroup" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {([true, false] as const).map(v => (
            <button
              type="button"
              key={String(v)}
              role="radio"
              aria-checked={value === v}
              disabled={disabled}
              onClick={() => onChange(v)}
              style={{ ...pillStyle(theme, value === v), justifyContent: 'center', fontWeight: 600 }}
            >
              {v ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      )
    default:
      return null
  }
}
