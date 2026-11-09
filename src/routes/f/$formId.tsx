import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { getPublicFormFn } from '../../server/functions'
import { FormView } from '../../features/forms/components/FormView'

interface FormSearch {
  /** Drawn inside the embed's iframe: no page around it, and it tells the parent its height. */
  embed?: boolean
  /** Back from a plain HTML form's post. */
  sent?: boolean
  error?: string
}

export const Route = createFileRoute('/f/$formId')({
  validateSearch: (search: Record<string, unknown>): FormSearch => ({
    embed: search.embed === 1 || search.embed === '1' || search.embed === true ? true : undefined,
    sent: search.sent === 1 || search.sent === '1' || search.sent === true ? true : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  loader: ({ params }) => getPublicFormFn({ data: { id: params.formId } }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.name ?? 'Form' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: HostedFormPage,
})

const ERRORS: Record<string, string> = {
  paused: "This form isn't taking submissions right now.",
  invalid: 'Some of the details were missing or not quite right. Please try again.',
  server: 'Something went wrong on our side. Please try again.',
}

/**
 * A form's own page, to share as a link, and what the iframe embed shows. It
 * has its own look, set in the builder, rather than the app's.
 */
function HostedFormPage() {
  const form = Route.useLoaderData()
  const { formId } = Route.useParams()
  const { embed, sent, error } = Route.useSearch()
  const root = useRef<HTMLDivElement>(null)

  // Inside an iframe: tell the page around it how tall the form is, as it changes.
  useEffect(() => {
    if (!embed || !root.current || window.parent === window) return
    const post = () => window.parent.postMessage({ type: 'magpie-form:height', id: formId, height: Math.ceil(root.current!.getBoundingClientRect().height) + 4 }, '*')
    const ro = new ResizeObserver(post)
    ro.observe(root.current)
    post()
    return () => ro.disconnect()
  }, [embed, formId])

  const dark = form?.style.theme === 'dark'
  const page = embed ? 'transparent' : dark ? '#111316' : '#f3f4f6'

  const body = !form ? (
    <p style={{ margin: 0, color: '#5b616e', fontFamily: 'system-ui, sans-serif' }}>This form doesn't exist any more.</p>
  ) : (
    <>
      {error && ERRORS[error] && (
        <p role="alert" style={{ margin: '0 0 16px', color: dark ? '#f97066' : '#b42318', fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>{ERRORS[error]}</p>
      )}
      {form.paused && !sent ? (
        <p style={{ margin: 0, color: dark ? '#a1a1aa' : '#5b616e', fontFamily: 'system-ui, sans-serif' }}>{ERRORS.paused}</p>
      ) : (
        <FormView
          form={form}
          done={sent}
          onSubmit={async (values) => {
            const res = await fetch(`/api/form-submit/${encodeURIComponent(formId)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(values),
            })
            const json = await res.json().catch(() => ({}))
            return res.ok ? { ok: true, message: json.message } : { ok: false, error: json.error, problems: json.problems }
          }}
        />
      )}
    </>
  )

  return (
    <>
      <style>{`html,body{background:${page}!important;margin:0}`}</style>
      {embed ? (
        <div ref={root} style={{ padding: 2 }}>{body}</div>
      ) : (
        <main style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '48px 16px' }}>
          <div
            ref={root}
            style={{
              width: '100%', maxWidth: 560, background: dark ? '#1d2025' : '#fff', borderRadius: 14, padding: '32px 28px',
              boxShadow: dark ? 'none' : '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1)', border: dark ? '1px solid #2d3139' : '1px solid #e5e7eb',
            }}
          >
            {form && (
              <h1 style={{ margin: '0 0 24px', fontSize: 24, lineHeight: 1.25, fontWeight: 700, color: dark ? '#f4f4f5' : '#111827', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif' }}>
                {form.name}
              </h1>
            )}
            {body}
          </div>
        </main>
      )}
    </>
  )
}
