import type React from 'react'
import { useEffect, useState } from 'react'
import type { AnswerValue, Answers, SurveyDesign, SurveySettings } from '../types'
import { resolveNext } from '../logic/evaluate'
import { validatePage } from '../logic/validate'
import { SurveyBlockView } from './SurveyBlockView'
import { SurveyStyles, mix } from './questions'

export type SubmitPageResult =
  | { ok: true; next: { kind: 'page'; pageId: string } | { kind: 'end' } }
  | { ok: false; errors?: Record<string, string>; message?: string }

export interface SurveyRendererProps {
  design: SurveyDesign
  settings: Pick<SurveySettings, 'allowBack' | 'thankYou'>
  initialAnswers?: Answers
  /** Pages already visited, oldest first; the last one is shown. Enables Back after a resume. */
  initialPath?: string[]
  /** Show the thank-you screen straight away (already completed). */
  initiallyCompleted?: boolean
  /**
   * Persist one page. Omit for an offline preview, where logic and
   * validation run locally only.
   */
  submitPage?: (args: { pageId: string; answers: Answers; complete: boolean }) => Promise<SubmitPageResult>
  /** Transparent outer background, for iframes on third-party pages. */
  embedded?: boolean
  /** Honeypot field value, read by the submit handler. */
  honeypotRef?: React.RefObject<HTMLInputElement | null>
  /** Blocks answered for the respondent (e.g. Email, when the link identifies them) and not shown. */
  hiddenBlockIds?: string[]
  /** Inside the builder's preview: no full-window height, the card at the top. */
  framed?: boolean
}

/**
 * The survey as respondents see it: paging, back navigation, validation,
 * skip logic and the thank-you screen. Styled inline from the theme.
 */
export function SurveyRenderer({
  design,
  settings,
  initialAnswers,
  initialPath,
  initiallyCompleted,
  submitPage,
  embedded,
  honeypotRef,
  hiddenBlockIds,
  framed,
}: SurveyRendererProps) {
  const { theme, pages } = design
  const [answers, setAnswers] = useState<Answers>(initialAnswers ?? {})
  const [history, setHistory] = useState<string[]>(() => {
    const valid = (initialPath ?? []).filter(id => pages.some(p => p.id === id))
    return valid.length ? valid : pages[0] ? [pages[0].id] : []
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(!!initiallyCompleted)

  const pageId = history[history.length - 1]
  const page = pages.find(p => p.id === pageId) ?? pages[0]
  const pageIndex = pages.findIndex(p => p.id === page?.id)
  const isLast = page ? resolveNext(design, page.id, answers).kind === 'end' : true

  useEffect(() => {
    if (done && settings.thankYou.redirectUrl) {
      const t = setTimeout(() => {
        window.top!.location.href = settings.thankYou.redirectUrl!
      }, 1500)
      return () => clearTimeout(t)
    }
  }, [done, settings.thankYou.redirectUrl])

  const setAnswer = (id: string, value: AnswerValue) => {
    setAnswers(prev => ({ ...prev, [id]: value }))
    if (errors[id]) setErrors(prev => ({ ...prev, [id]: '' }))
  }

  const handleNext = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!page || submitting) return
    setMessage(null)
    const local = validatePage(page, answers)
    if (!local.ok) {
      setErrors(local.errors)
      return
    }
    const complete = resolveNext(design, page.id, local.answers).kind === 'end'

    let result: SubmitPageResult = { ok: true, next: resolveNext(design, page.id, answers) }
    if (submitPage) {
      setSubmitting(true)
      try {
        result = await submitPage({ pageId: page.id, answers: local.answers, complete })
      } catch {
        result = { ok: false, message: 'Something went wrong. Please try again.' }
      } finally {
        setSubmitting(false)
      }
    }

    if (!result.ok) {
      if (result.errors) setErrors(result.errors)
      setMessage(result.message ?? 'Please check your answers.')
      return
    }
    setErrors({})
    if (result.next.kind === 'end') setDone(true)
    else {
      const nextId = result.next.pageId
      setHistory(prev => [...prev, nextId])
    }
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // A page whose every block is hidden (only an Email question, for an
  // identified respondent) has nothing to show, so submit it straight away.
  const visibleBlocks = page ? page.blocks.filter(b => !hiddenBlockIds?.includes(b.id)) : []
  const pageIsHidden = !!page && page.blocks.length > 0 && visibleBlocks.length === 0
  useEffect(() => {
    if (pageIsHidden && !done && !submitting && !message) void handleNext()
    // handleNext reads current state; re-run only when the page changes.
  }, [pageId, pageIsHidden])

  // Back steps over auto-submitted pages, or it would bounce straight forward again.
  const isHiddenPage = (id: string) => {
    const p = pages.find(x => x.id === id)
    return !!p && p.blocks.length > 0 && p.blocks.every(b => hiddenBlockIds?.includes(b.id))
  }
  const canGoBack = history.slice(0, -1).some(id => !isHiddenPage(id))
  const goBack = () =>
    setHistory(prev => {
      let next = prev.slice(0, -1)
      while (next.length > 1 && isHiddenPage(next[next.length - 1])) next = next.slice(0, -1)
      return next
    })

  const outer = framed ? { ...pageStyle(theme, true), padding: '32px 16px', background: 'transparent' } : pageStyle(theme, embedded)
  const card = cardStyle(theme, embedded)
  const button = (primary: boolean): React.CSSProperties => ({
    padding: '11px 22px',
    fontSize: 15,
    fontWeight: 600,
    fontFamily: theme.fontFamily,
    cursor: submitting ? 'wait' : 'pointer',
    borderRadius: theme.buttonRadius,
    border: primary ? 'none' : `1px solid ${mix(theme.textColor, 0.42)}`,
    background: primary ? theme.accentColor : 'transparent',
    color: primary ? theme.buttonTextColor : theme.textColor,
    opacity: submitting ? 0.7 : 1,
  })

  if (done || !page) {
    return <SurveyMessage theme={theme} title={settings.thankYou.title} body={settings.thankYou.message} embedded={embedded || framed} />
  }

  // Pages finished, out of the ones this person will see: logic can skip some,
  // so the last page they get counts as the end, and the bar is never full
  // before they've sent it.
  const pagesDone = history.length - 1
  const total = pagesDone + 1 + (isLast ? 0 : Math.max(1, pages.length - pageIndex - 1))
  // The bar shows the page they're on out of the pages they'll see, as its label says.
  const progress = pages.length > 1 ? Math.round(((pagesDone + 1) / total) * 100) : null

  return (
    <div style={outer} className="sv-root">
      <SurveyStyles theme={theme} />
      <form style={card} onSubmit={handleNext} noValidate>
        {theme.logoUrl && (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <img src={theme.logoUrl} alt="" style={{ maxHeight: 40 }} />
          </div>
        )}
        {theme.showProgressBar && progress !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <div
              role="progressbar"
              aria-label={`Page ${pagesDone + 1} of ${total}`}
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ flex: 1, height: 6, background: mix(theme.textColor, 0.1), borderRadius: 999, overflow: 'hidden' }}
            >
              <div style={{ height: '100%', width: `${Math.max(progress, 3)}%`, background: theme.accentColor, borderRadius: 999, transition: 'width 300ms' }} />
            </div>
            <span style={{ fontSize: 13, opacity: 0.75, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} aria-hidden>
              Page {pagesDone + 1} of {total}
            </span>
          </div>
        )}

        {/* Honeypot: hidden from people, filled in by naive bots. */}
        <input
          ref={honeypotRef}
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          style={{ position: 'absolute', left: -10000, width: 1, height: 1, opacity: 0 }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visibleBlocks.map(block => (
            <div
              key={block.id}
              style={theme.cardMode ? { border: `1px solid ${mix(theme.textColor, 0.1)}`, borderRadius: theme.cardRadius ?? 12, padding: '4px 16px' } : undefined}
            >
              <SurveyBlockView
                block={block}
                theme={theme}
                value={answers[block.id]}
                onChange={v => setAnswer(block.id, v)}
                error={errors[block.id] || undefined}
              />
            </div>
          ))}
        </div>

        {message && (
          <p role="alert" style={{ color: '#dc2626', fontSize: 14, margin: '16px 0 0' }}>
            {message}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 28 }}>
          {settings.allowBack && canGoBack ? (
            <button type="button" style={button(false)} onClick={goBack} disabled={submitting}>
              {theme.backLabel}
            </button>
          ) : (
            <span />
          )}
          <button type="submit" style={button(true)} disabled={submitting}>
            {isLast ? theme.submitLabel : theme.nextLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

/** The hosted page around the card: the survey's background, its font, and room above. */
function pageStyle(theme: SurveyDesign['theme'], embedded?: boolean): React.CSSProperties {
  return {
    minHeight: embedded ? undefined : '100vh',
    boxSizing: 'border-box',
    // A short page sits in the middle of the window; a long one starts near the top and scrolls.
    display: 'flex',
    flexDirection: 'column',
    justifyContent: embedded ? 'flex-start' : 'center',
    padding: embedded ? 0 : 'clamp(24px, 6vh, 64px) 16px',
    background: embedded ? 'transparent' : theme.bgImage ? `${theme.pageBgColor} url(${JSON.stringify(theme.bgImage)}) center/cover` : theme.pageBgColor,
    fontFamily: theme.fontFamily,
    lineHeight: theme.lineHeight,
    color: theme.textColor,
  }
}

export function cardStyle(theme: SurveyDesign['theme'], embedded?: boolean): React.CSSProperties {
  return {
    width: '100%',
    maxWidth: theme.bodyWidth,
    margin: '0 auto',
    boxSizing: 'border-box',
    background: theme.cardBgColor,
    borderRadius: theme.cardRadius ?? 12,
    // Its side padding is a variable, so the builder can put a block's tools just outside the card.
    ['--sv-card-pad' as string]: 'clamp(18px, 5vw, 32px)',
    padding: 'clamp(20px, 5vw, 36px) var(--sv-card-pad)',
    boxShadow: embedded ? undefined : `0 0 0 1px ${mix(theme.textColor, 0.05)}, 0 1px 2px ${mix(theme.textColor, 0.04)}, 0 12px 32px -16px ${mix(theme.textColor, 0.18)}`,
  }
}

/**
 * A card with a heading and a line, in the survey's own look and in the same
 * place as its pages: the thank-you once it's sent, and the closed or
 * broken-link pages.
 */
export function SurveyMessage({ theme, title, body, embedded }: { theme: SurveyDesign['theme']; title: string; body: string; embedded?: boolean }) {
  return (
    <div style={pageStyle(theme, embedded)} className="sv-root">
      <div style={{ ...cardStyle(theme, embedded), textAlign: 'center', paddingTop: 48, paddingBottom: 48 }}>
        {theme.logoUrl && <img src={theme.logoUrl} alt="" style={{ maxHeight: 40, marginBottom: 20 }} />}
        <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700, lineHeight: 1.25 }}>{title}</h1>
        <p style={{ margin: 0, opacity: 0.8, whiteSpace: 'pre-wrap' }}>{body}</p>
      </div>
    </div>
  )
}
