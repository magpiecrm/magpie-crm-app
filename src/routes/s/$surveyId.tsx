import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { getPublicSurveyFn } from '../../server/functions'
import type { Answers, ResponseSource, SurveyDesign } from '../../features/survey-builder/types'
import { computePath, findQuestion } from '../../features/survey-builder/logic/evaluate'
import { validateAnswer } from '../../features/survey-builder/logic/validate'
import { SurveyMessage, SurveyRenderer, type SubmitPageResult } from '../../features/survey-builder/runtime/SurveyRenderer'
import { DEFAULT_SURVEY_THEME } from '../../features/survey-builder/types'

interface SurveySearch {
  /** Per-recipient token from an email. */
  t?: string
  /** Email-inline answer: question id and value. */
  q?: string
  a?: string
  /** Rendered inside the embed iframe. */
  embed?: boolean
  /** Owner preview of a draft. */
  preview?: boolean
  /** Where an anonymous link was shared from, e.g. `qr` for printed QR codes. */
  src?: 'qr'
}

export const Route = createFileRoute('/s/$surveyId')({
  validateSearch: (search: Record<string, unknown>): SurveySearch => ({
    t: typeof search.t === 'string' ? search.t : undefined,
    q: typeof search.q === 'string' ? search.q : undefined,
    a: search.a === undefined ? undefined : String(search.a),
    embed: search.embed === 1 || search.embed === '1' || search.embed === true ? true : undefined,
    preview: search.preview === 1 || search.preview === '1' || search.preview === true ? true : undefined,
    src: search.src === 'qr' ? 'qr' : undefined,
  }),
  loaderDeps: ({ search }) => ({ t: search.t, preview: search.preview }),
  loader: ({ params, deps }) => getPublicSurveyFn({ data: { id: params.surveyId, t: deps.t, preview: deps.preview } }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.state === 'open' ? loaderData.survey.name : 'Survey' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: PublicSurveyPage,
})

type Stored = { resumeKey: string; answers: Answers; path: string[] }
const storageKey = (id: string) => `em-survey:${id}`

function readStored(id: string): Stored | null {
  try {
    const raw = localStorage.getItem(storageKey(id))
    return raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    return null
  }
}

function writeStored(id: string, value: Stored | null) {
  try {
    if (value) localStorage.setItem(storageKey(id), JSON.stringify(value))
    else localStorage.removeItem(storageKey(id))
  } catch {
    // Storage can be blocked (e.g. partitioned iframes); resuming is best-effort.
  }
}

function PublicSurveyPage() {
  const data = Route.useLoaderData()
  const { surveyId } = Route.useParams()
  const search = Route.useSearch()

  const embedded = search.embed
  if (data.state === 'not_found') return <SurveyMessage theme={DEFAULT_SURVEY_THEME} embedded={embedded} title="Survey not found" body="This survey doesn't exist, or hasn't been published yet." />
  if (data.state === 'closed') return <SurveyMessage theme={data.theme} embedded={embedded} title={data.name} body="This survey has closed and isn't taking answers any more. Thank you for your interest." />
  if (data.state === 'invalid_link')
    return <SurveyMessage theme={data.theme} embedded={embedded} title={data.name} body="This link has expired or isn't valid. Reload the page you opened it from, or use the link in your email." />

  return <OpenSurvey key={surveyId} data={data} surveyId={surveyId} search={search} />
}

type OpenData = Extract<Awaited<ReturnType<typeof getPublicSurveyFn>>, { state: 'open' }>

function OpenSurvey({ data, surveyId, search }: { data: OpenData; surveyId: string; search: SurveySearch }) {
  const design = data.survey.design as SurveyDesign
  const startedAt = useRef(Date.now())
  const honeypotRef = useRef<HTMLInputElement>(null)
  const resumeKeyRef = useRef<string | null>(null)
  const source: ResponseSource = search.embed ? 'embed' : search.t ? 'email' : search.src === 'qr' ? 'qr' : 'link'

  // null until the client knows where to start (localStorage and the inline answer are client-only).
  const [start, setStart] = useState<{ answers: Answers; path: string[]; done: boolean } | null>(null)

  const post = async (pageId: string, answers: Answers, as: ResponseSource = source): Promise<SubmitPageResult> => {
    const res = await fetch(`/api/survey/${surveyId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        t: search.t,
        resumeKey: resumeKeyRef.current,
        source: as,
        pageId,
        answers,
        hp: honeypotRef.current?.value || undefined,
        startedAt: startedAt.current,
        referrer: document.referrer || undefined,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, errors: body.errors, message: body.error }
    if (body.resumeKey) resumeKeyRef.current = body.resumeKey
    return { ok: true, next: body.next }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let answers: Answers = { ...(data.resume?.answers ?? {}), ...(data.identified?.answers ?? {}) }
      let path = data.resume?.path?.length ? [...data.resume.path] : []
      if (data.resume?.pageId && path[path.length - 1] !== data.resume.pageId) path.push(data.resume.pageId)

      if (!search.t) {
        const stored = readStored(surveyId)
        if (stored) {
          resumeKeyRef.current = stored.resumeKey
          answers = { ...stored.answers, ...answers }
          if (!path.length) path = stored.path
        }
      }

      // An answer clicked inside the email: preselect it, then record it by POST.
      // Recording on GET would let link scanners "answer" for the recipient.
      const block = search.q ? findQuestion(design, search.q) : undefined
      const inline = block && search.a !== undefined ? validateAnswer(block, search.a) : null
      if (block && inline?.ok && inline.value !== null && !data.completed) {
        answers[block.id] = inline.value
        const page = design.pages.find(p => p.blocks.some(b => b.id === block.id))!
        const pageAnswers = Object.fromEntries(page.blocks.filter(b => b.id in answers).map(b => [b.id, answers[b.id]]))
        const result = await post(page.id, pageAnswers, 'email_inline').catch(() => null)
        if (result?.ok && result.next.kind === 'end') {
          if (!cancelled) setStart({ answers, path: [], done: true })
          return
        }
        path = result?.ok && result.next.kind === 'page' ? [page.id, result.next.pageId] : [page.id]
      }
      if (!cancelled) setStart({ answers, path, done: false })
    })()
    return () => {
      cancelled = true
    }
    // Runs once per mount; the inputs come from the loader and URL.
  }, [])

  // In a pop-up or slide-in, Escape closes it, as it does on the page around it.
  useEffect(() => {
    if (!search.embed) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && window.parent.postMessage({ type: 'em-survey:escape', id: surveyId }, '*')
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [search.embed, surveyId])

  // Let the embedding page size the iframe to the survey.
  useEffect(() => {
    if (!search.embed || typeof ResizeObserver === 'undefined') return
    const send = () => window.parent.postMessage({ type: 'em-survey:height', id: surveyId, height: document.documentElement.scrollHeight }, '*')
    const observer = new ResizeObserver(send)
    observer.observe(document.body)
    send()
    return () => observer.disconnect()
  }, [search.embed, surveyId])

  if (!start) return <div style={{ minHeight: search.embed ? 200 : '100vh', background: search.embed ? 'transparent' : design.theme.pageBgColor }} />

  const finished = data.completed || start.done

  return (
    <SurveyRenderer
      design={design}
      settings={data.survey.settings}
      initialAnswers={start.answers}
      initialPath={finished ? undefined : start.path}
      initiallyCompleted={finished}
      embedded={search.embed}
      honeypotRef={honeypotRef}
      hiddenBlockIds={data.identified?.hiddenBlockIds}
      submitPage={async ({ pageId, answers }) => {
        const result = await post(pageId, answers)
        // Finished inside an embed: a pop-up's script stops offering it to this visitor.
        if (search.embed && result.ok && result.next.kind === 'end') window.parent.postMessage({ type: 'em-survey:done', id: surveyId }, '*')
        if (!search.t && resumeKeyRef.current) {
          if (result.ok && result.next.kind === 'end') writeStored(surveyId, null)
          else if (result.ok && result.next.kind === 'page') {
            const merged = { ...readStored(surveyId)?.answers, ...answers }
            writeStored(surveyId, {
              resumeKey: resumeKeyRef.current,
              answers: merged,
              // The path is fully determined by the answers, so replay it rather than track navigation.
              path: computePath(design, merged, result.next.pageId),
            })
          }
        }
        return result
      }}
    />
  )
}
