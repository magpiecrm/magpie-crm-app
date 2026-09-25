import type React from 'react'
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
export function SurveyBlockView({ block, theme, value, onChange, error, disabled }: SurveyBlockViewProps) {
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
          {q.title || <em style={{ opacity: 0.5 }}>Untitled question</em>}
          {q.required && <span style={{ color: theme.accentColor, marginLeft: 4 }} aria-label="required">*</span>}
        </div>
        {q.description && <div style={{ fontSize: 14, opacity: 0.75, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{q.description}</div>}
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
          {block.content}
        </h2>
      )
    case 'text':
      return (
        <p style={{ ...wrapper, margin: 0, fontSize: s.fontSize ?? 15, fontWeight: s.fontWeight === 'bold' ? 700 : 400, whiteSpace: 'pre-wrap' }}>
          {block.content}
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
