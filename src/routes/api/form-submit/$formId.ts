import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../../server/db'
import { notify } from '../../../server/notify'
import { writeCustomValues } from '../../../server/contactFieldValues'
import { checkSubmission, cleanSource, contactFieldsOf, fillMergeTags, HONEYPOT, publicForm, type FormSubmissionRecord } from '../../../features/forms/model'

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }
}

/**
 * A form's submissions, from anywhere: the embed (JSON from the hosted page or
 * the plain HTML snippet), a plain `<form method="post">` (which is sent back
 * to the hosted page's thank-you), or someone's own code. Snippets pasted
 * before fields could be changed send the same names, so they keep working.
 */
export const Route = createFileRoute('/api/form-submit/$formId')({
  server: {
    handlers: {
      OPTIONS: async ({ request }: { request: Request }) => {
        const origin = request.headers.get('origin') || '*'
        return new Response(null, { status: 200, headers: corsHeaders(origin) })
      },
      POST: async ({ request, params }: { request: Request; params: { formId: string } }) => {
        const origin = request.headers.get('origin') || '*'
        const headers = corsHeaders(origin)
        const type = request.headers.get('content-type') || ''
        const isHtmlForm = type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')
        const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers })
        // A plain HTML form lands on the hosted page, which says thanks or what went wrong.
        const back = (query: string) =>
          new Response(null, { status: 303, headers: { Location: `${new URL(request.url).origin}/f/${encodeURIComponent(params.formId)}?${query}` } })

        const form = db.getForm(params.formId)
        if (!form) return isHtmlForm ? back('error=not_found') : json(404, { success: false, error: 'Form not found' })
        if (form.paused) return isHtmlForm ? back('error=paused') : json(403, { success: false, error: "This form isn't taking submissions right now." })

        let body: Record<string, unknown>
        try {
          if (isHtmlForm) {
            body = {}
            const fd = await request.formData()
            for (const key of new Set(fd.keys())) {
              const all = fd.getAll(key).filter((v): v is string => typeof v === 'string')
              body[key] = all.length > 1 ? all : all[0] ?? ''
            }
          } else {
            const parsed = await request.json()
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
            body = parsed as Record<string, unknown>
          }
        } catch {
          return isHtmlForm ? back('error=invalid') : json(400, { success: false, error: 'Invalid JSON' })
        }

        // Bots fill every field; people never see this one. Thank them and keep nothing.
        if (typeof body[HONEYPOT] === 'string' && body[HONEYPOT]) return isHtmlForm ? back('sent=1') : json(200, { success: true })

        const contactFields = db.getContactFields()
        const { fields, successMessage } = publicForm(form, contactFields)
        const checked = checkSubmission(fields, body, contactFields)
        if (!checked.ok) {
          const first = Object.values(checked.problems)[0]
          return isHtmlForm
            ? back(`error=invalid`)
            : json(400, { success: false, error: first, problems: checked.problems })
        }
        const { email, values, custom } = checked
        const str = (k: string) => (typeof values[k] === 'string' ? (values[k] as string) : '')

        const outcome: NonNullable<FormSubmissionRecord['outcome']> = {}
        try {
          if (form.save_to_list_enabled !== false && form.list_id) {
            const save = new Set(contactFieldsOf(form))
            const existing = db.getContact(email)
            outcome.list_id = form.list_id
            outcome.new_contact = !existing
            // New details fill blanks; what a contact already has stays.
            const builtin: Record<string, string> = {}
            for (const k of ['first_name', 'last_name', 'company', 'job_title'] as const) {
              if (save.has(k) && str(k) && !existing?.[k]) builtin[k] = str(k)
            }
            db.upsertContact(email, { builtin }, { create: true, status: 'subscribed' })
            db.addContactToList(form.list_id, email)
            const customValues = Object.fromEntries(Object.entries(custom).filter(([k]) => save.has(`custom:${k}`)))
            if (Object.keys(customValues).length) writeCustomValues([{ email, values: customValues }], { blanks: 'keep' })
            // They signed themselves up: consent that outlasts an earlier opt-out from prospecting.
            db.markSignedUp(email)
          }

          if (form.welcome_email_enabled && form.welcome_email_subject) {
            const html = `<div style="font-family:inherit;line-height:1.6">${fillMergeTags(form.welcome_email_body, values, { html: true }).replace(/\n/g, '<br/>')}</div>`
            let from: string | undefined
            if (form.sender_id) {
              const sender = db.data.senders.find((s) => s.id === form.sender_id)
              if (sender) from = `"${sender.name}" <${sender.email}>`
            }
            outcome.welcome_email_id = db.addPendingEmail(email, str('first_name'), fillMergeTags(form.welcome_email_subject, values), html, form.welcome_email_delay_minutes * 60 * 1000, from)
          }

          const consent = fields.find((f) => f.key === 'consent')
          // The page sends where it sits (`_page`, `_referrer`); a plain HTML post says it in its Referer.
          const source = cleanSource(body._page ?? (isHtmlForm ? request.headers.get('referer') : undefined), body._referrer)
          db.addFormSubmission(params.formId, email, values, {
            ...(consent && values.consent === true ? { consent_text: consent.label } : {}),
            ...(source ? { source } : {}),
            outcome,
          })
          const name = `${str('first_name')} ${str('last_name')}`.trim()
          notify('form_submission', `${name || email} submitted "${form.name}"`, { contactEmail: email, url: `/marketing/forms/${params.formId}` })

          return isHtmlForm ? back('sent=1') : json(200, { success: true, message: successMessage })
        } catch (err) {
          console.error('[form-submit] Error:', err)
          return isHtmlForm ? back('error=server') : json(500, { success: false, error: 'Internal server error' })
        }
      },
    },
  },
})
