import type React from 'react'
import { useEffect, useRef } from 'react'
import type { AnswerValue, SurveyBlock, SurveyTheme } from '../types'
import { isQuestionType } from '../types'
import { QuestionInput, mix } from './questions'

interface SurveyBlockViewProps {
  block: SurveyBlock
  theme: SurveyTheme
  value?: AnswerValue
  onChange?: (value: AnswerValue) => void
  error?: string
  /** Canvas mode: inputs render but can't be interacted with. */
  disabled?: boolean
  /** Builder only: type the question's title, or a heading's or text's words, right where they show. */
  onEditText?: (text: string) => void
}

/**
 * Text typed in place on the canvas. Uncontrolled while it has focus, so
 * React never rewrites it under the caret; Enter finishes a one-line title.
 */
function EditableText({ value, onChange, multiline, placeholder, style }: { value: string; onChange: (v: string) => void; multiline?: boolean; placeholder: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current && ref.current.textContent !== value) ref.current.textContent = value
  }, [value])
  return (
    <span
      ref={ref}
      role="textbox"
      aria-label={placeholder}
      aria-multiline={multiline || undefined}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={e => onChange(e.currentTarget.textContent ?? '')}
      onKeyDown={e => {
        if (e.key === 'Enter' && !multiline) (e.preventDefault(), e.currentTarget.blur())
        e.stopPropagation()
      }}
      onClick={e => e.stopPropagation()}
      className="sv-editable"
      style={{ pointerEvents: 'auto', userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text', outline: 'none', whiteSpace: multiline ? 'pre-wrap' : undefined, ...style }}
    />
  )
}

const DEFAULT_PADDING = { top: 8, right: 0, bottom: 8, left: 0 }

function padding(block: SurveyBlock): React.CSSProperties {
  const s = block.style ?? {}
  const all = s.padding
  return {
    paddingTop: s.paddingTop ?? all ?? DEFAULT_PADDING.top,
    paddingRight: s.paddingRight ?? all ?? DEFAULT_PADDING.right,
    paddingBottom: s.paddingBottom ?? all ?? DEFAULT_PADDING.bottom,
    paddingLeft: s.paddingLeft ?? all ?? DEFAULT_PADDING.left,
  }
}

/**
 * One block as a respondent sees it. Used by the public renderer and, with
 * `disabled`, by the builder canvas — so the canvas is exactly what gets
 * published rather than an approximation of it.
 */
export function SurveyBlockView({ block, theme, value, onChange, error, disabled, onEditText }: SurveyBlockViewProps) {
  const s = block.style ?? {}
  const textAlign = s.textAlign ?? block.align
  const wrapper: React.CSSProperties = {
    ...padding(block),
    background: s.bgColor,
    borderRadius: s.borderRadius,
    color: s.color ?? theme.textColor,
    textAlign,
  }

  if (isQuestionType(block.type) && block.question) {
    const q = block.question
    const labelId = `q-${block.id}-label`
    return (
      <div style={wrapper} role="group" aria-labelledby={labelId}>
        <div id={labelId} style={{ fontSize: s.fontSize ?? 17, fontWeight: 600, marginBottom: q.description ? 4 : 10 }}>
          {onEditText ? (
            <EditableText value={q.title} onChange={onEditText} placeholder="Type the question" />
          ) : (
            // The asterisk is joined to the last word, so it never wraps onto a line of its own.
            <QuestionTitle title={q.title} required={q.required} />
          )}
          {onEditText && q.required && (
            // A word joiner, so the mark can't break away from the title being typed.
            <span style={{ opacity: 0.6, whiteSpace: 'nowrap' }} aria-hidden>
              {'\u2060\u00a0*'}
            </span>
          )}
        </div>
        {q.description && <div style={{ fontSize: 14, opacity: 0.75, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{q.description}</div>}
        {block.type === 'multiple_choice' && (
          // How many they may pick, said before they start, not after a refusal.
          <div style={{ fontSize: 13, opacity: 0.75, marginTop: q.description ? -4 : -6, marginBottom: 10 }}>
            {q.maxSelect && q.minSelect ? `Pick ${q.minSelect} to ${q.maxSelect}` : q.maxSelect ? `Pick up to ${q.maxSelect}` : q.minSelect ? `Pick at least ${q.minSelect}` : 'Pick as many as you like'}
          </div>
        )}
        <QuestionInput block={block} theme={theme} value={value} onChange={v => onChange?.(v)} disabled={disabled} />
        {error && (
          <div role="alert" style={{ color: '#dc2626', fontSize: 13, marginTop: 6 }}>
            {error}
          </div>
        )}
      </div>
    )
  }

  switch (block.type) {
    case 'heading':
      return (
        <h2 style={{ ...wrapper, margin: 0, fontSize: s.fontSize ?? 26, fontWeight: s.fontWeight === 'normal' ? 400 : 700, lineHeight: 1.25 }}>
          {onEditText ? <EditableText value={block.content ?? ''} onChange={onEditText} placeholder="Type a heading" /> : block.content}
        </h2>
      )
    case 'text':
      return (
        <p style={{ ...wrapper, margin: 0, fontSize: s.fontSize ?? 15, fontWeight: s.fontWeight === 'bold' ? 700 : 400, whiteSpace: 'pre-wrap' }}>
          {onEditText ? <EditableText multiline value={block.content ?? ''} onChange={onEditText} placeholder="Type some text" /> : block.content}
        </p>
      )
    case 'image': {
      if (!block.content) return null
      const img = (
        <img
          src={block.content}
          alt={block.alt ?? ''}
          style={{ display: 'inline-block', maxWidth: '100%', width: block.width ?? '100%', height: s.height ? `${s.height}px` : 'auto', objectFit: 'cover', borderRadius: s.borderRadius }}
        />
      )
      return (
        <div style={{ ...wrapper, textAlign: block.align ?? 'center' }}>
          {block.url && !disabled ? (
            <a href={block.url} target="_blank" rel="noopener noreferrer">
              {img}
            </a>
          ) : (
            img
          )}
        </div>
      )
    }
    case 'divider':
      return (
        <div style={wrapper}>
          <hr style={{ border: 'none', borderTop: `1px solid ${s.color ?? mix(theme.textColor, 0.15)}`, margin: 0 }} />
        </div>
      )
    case 'spacer':
      return <div aria-hidden style={{ height: s.height ?? (Number(block.content) || 24) }} />
    case 'html':
      // Only the survey owner can author this, same as the email builder's html block.
      return <div style={wrapper} dangerouslySetInnerHTML={{ __html: block.content ?? '' }} />
    default:
      return null
  }
}

/** A question's title with its required mark held to the last word by a no-break space. */
function QuestionTitle({ title, required }: { title: string; required: boolean }) {
  if (!title) return <em style={{ opacity: 0.5 }}>Untitled question</em>
  if (!required) return <>{title}</>
  const cut = title.trimEnd().lastIndexOf(' ')
  const head = cut >= 0 ? title.slice(0, cut + 1) : ''
  const last = cut >= 0 ? title.slice(cut + 1) : title
  return (
    <>
      {head}
      <span style={{ whiteSpace: 'nowrap' }}>
        {last}
        {'\u00a0'}
        <span style={{ opacity: 0.6 }} aria-hidden>
          *
        </span>
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}> (required)</span>
      </span>
    </>
  )
}
